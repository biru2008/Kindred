-- Apply once after 001–006. Preserves existing accounts, messages, and files.
begin;
alter table public.messages add column reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column pinned_at timestamptz;
alter table public.messages add column pinned_by uuid references public.profiles(id) on delete set null;
create index messages_pins_idx on public.messages(conversation_id,pinned_at) where pinned_at is not null;
create table public.message_reactions(
 message_id uuid not null references public.messages(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 emoji text not null check(emoji in ('❤️','👍','😂','😮','😢','🙌')),
 primary key(message_id,user_id,emoji)
);
create table public.conversation_preferences(
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 muted boolean not null default false, archived boolean not null default false,
 primary key(conversation_id,user_id)
);
alter table public.message_reactions enable row level security;
alter table public.conversation_preferences enable row level security;
create policy reactions_read on public.message_reactions for select to authenticated using(
 exists(select 1 from public.messages m where m.id=message_id and m.deleted_at is null and private.is_member(m.conversation_id))
);
create policy preferences_read on public.conversation_preferences for select to authenticated using(user_id=auth.uid() and private.is_member(conversation_id));
grant select on public.message_reactions,public.conversation_preferences to authenticated;
create function private.check_reply(conversation uuid,target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_member(conversation) then raise exception 'Reply target unavailable'; end if;
 perform 1 from public.messages where id=target and conversation_id=conversation and deleted_at is null for update;
 if not found then raise exception 'Reply target unavailable'; end if;
end; $$;
revoke all on function private.check_reply(uuid,uuid) from public,anon,authenticated;
create function public.send_reply(conversation uuid,message_id uuid,message_body text,target uuid) returns public.messages
language plpgsql security definer set search_path='' as $$
declare result public.messages;
begin
 perform pg_advisory_xact_lock(hashtextextended(message_id::text,0));
 perform private.check_reply(conversation,target);
 select * into result from public.messages where id=message_id;
 if found and (result.reply_to is distinct from target or result.deleted_at is not null) then raise exception 'Message identifier already used'; end if;
 result:=public.send_message(conversation,message_id,message_body);
 update public.messages set reply_to=target where id=message_id returning * into result;
 return result;
end; $$;
create function public.send_reply_attachment(conversation uuid,message_id uuid,object_path text,file_name text,caption text,target uuid) returns public.messages
language plpgsql security definer set search_path='' as $$
declare result public.messages;
begin
 perform pg_advisory_xact_lock(hashtextextended(message_id::text,0));
 perform private.check_reply(conversation,target);
 select * into result from public.messages where id=message_id;
 if found and (result.reply_to is distinct from target or result.deleted_at is not null) then raise exception 'Message identifier already used'; end if;
 result:=public.send_attachment(conversation,message_id,object_path,file_name,caption);
 update public.messages set reply_to=target where id=message_id returning * into result;
 return result;
end; $$;
create function public.set_message_reaction(message_id uuid,reaction text,enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if reaction is null or reaction not in ('❤️','👍','😂','😮','😢','🙌') or enabled is null then raise exception 'Invalid reaction'; end if;
 select conversation_id into cid from public.messages where id=message_id and deleted_at is null for update;
 if cid is null or not private.is_member(cid) then raise exception 'Message unavailable'; end if;
 if enabled then insert into public.message_reactions values(message_id,auth.uid(),reaction) on conflict do nothing;
 else delete from public.message_reactions r where r.message_id=set_message_reaction.message_id and r.user_id=auth.uid() and r.emoji=reaction; end if;
end; $$;
create function public.set_message_pin(message_id uuid,enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare cid uuid; kind text; role text; already boolean;
begin
 select conversation_id into cid from public.messages where id=message_id and deleted_at is null;
 if cid is null or not private.is_member(cid) or enabled is null then raise exception 'Message unavailable'; end if;
 select c.kind into kind from public.conversations c where c.id=cid for update;
 select m.role into role from public.conversation_members m where m.conversation_id=cid and m.user_id=auth.uid();
 if kind='group' and role not in ('owner','admin') then raise exception 'Only owners and admins can pin group messages'; end if;
 select pinned_at is not null into already from public.messages where id=message_id and deleted_at is null for update;
 if not found then raise exception 'Message unavailable'; end if;
 if enabled and not already and (select count(*) from public.messages where conversation_id=cid and pinned_at is not null and deleted_at is null)>=20 then raise exception 'Unpin a message first (maximum 20 pins)'; end if;
 update public.messages set pinned_at=case when enabled then coalesce(pinned_at,now()) end,pinned_by=case when enabled then coalesce(pinned_by,auth.uid()) end where id=message_id;
end; $$;
create function public.set_conversation_preferences(conversation uuid,mute boolean,archive boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_member(conversation) or mute is null or archive is null then raise exception 'Conversation unavailable'; end if;
 insert into public.conversation_preferences values(conversation,auth.uid(),mute,archive)
 on conflict(conversation_id,user_id) do update set muted=excluded.muted,archived=excluded.archived;
end; $$;
create function public.chat_features(conversation uuid,message_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.is_member(conversation) then raise exception 'Conversation unavailable'; end if;
 if message_ids is null or cardinality(message_ids)>1000 then raise exception 'Too many message identifiers'; end if;
 return jsonb_build_object(
  'reactions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.message_reactions r join public.messages m on m.id=r.message_id where m.conversation_id=conversation and m.id=any(message_ids) and m.deleted_at is null),
  'replies',(select coalesce(jsonb_agg(case when p.deleted_at is not null then to_jsonb(p)||jsonb_build_object('body','Message deleted','attachment',null) else to_jsonb(p) end),'[]') from public.messages p where p.conversation_id=conversation and p.id in(select m.reply_to from public.messages m where m.conversation_id=conversation and m.id=any(message_ids) and m.deleted_at is null)),
  'pins',(select coalesce(jsonb_agg(to_jsonb(p) order by p.pinned_at desc),'[]') from public.messages p where p.conversation_id=conversation and p.pinned_at is not null and p.deleted_at is null)
 );
end; $$;
create or replace function public.list_conversations() returns jsonb
language sql stable security invoker set search_path = '' as $$
 select coalesce(jsonb_agg(row_data order by sort_date desc), '[]'::jsonb) from (
 select c.updated_at sort_date, jsonb_build_object(
 'id', c.id, 'kind', c.kind, 'title', c.title, 'updated_at', c.updated_at,
 'muted',coalesce((select muted from public.conversation_preferences where conversation_id=c.id and user_id=auth.uid()),false),
 'archived',coalesce((select archived from public.conversation_preferences where conversation_id=c.id and user_id=auth.uid()),false),
 'members', (select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username, 'color', p.color, 'bio', p.bio, 'song_path', p.song_path, 'song_title', p.song_title, 'last_read_at', m.last_read_at, 'role', m.role))
  from public.conversation_members m join public.profiles p on p.id=m.user_id where m.conversation_id=c.id),
 'last_message', (select to_jsonb(msg) from public.messages msg where msg.conversation_id=c.id order by msg.created_at desc, msg.id desc limit 1),
 'unread', (select count(*) from public.messages msg join public.conversation_members mine on mine.conversation_id=msg.conversation_id and mine.user_id=auth.uid()
   where msg.conversation_id=c.id and msg.sender_id<>auth.uid() and msg.created_at>mine.last_read_at)
 ) row_data from public.conversations c
 ) data;
$$;


revoke all on function public.send_reply(uuid,uuid,text,uuid),public.send_reply_attachment(uuid,uuid,text,text,text,uuid),public.set_message_reaction(uuid,text,boolean),public.set_message_pin(uuid,boolean),public.set_conversation_preferences(uuid,boolean,boolean),public.chat_features(uuid,uuid[]) from public,anon;
grant execute on function public.send_reply(uuid,uuid,text,uuid),public.send_reply_attachment(uuid,uuid,text,text,text,uuid),public.set_message_reaction(uuid,text,boolean),public.set_message_pin(uuid,boolean),public.set_conversation_preferences(uuid,boolean,boolean),public.chat_features(uuid,uuid[]) to authenticated;
alter publication supabase_realtime add table public.message_reactions,public.conversation_preferences;
commit;
