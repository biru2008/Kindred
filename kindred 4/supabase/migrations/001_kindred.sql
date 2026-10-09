-- Kindred: run once in the Supabase SQL editor on a new project.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(btrim(display_name)) between 1 and 50),
 username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
 color text not null default 'fern' check (color in ('fern','lavender','peach','blue','rose','amber')),
 bio text not null default '' check (char_length(bio) <= 160),
 created_at timestamptz not null default now()
);
create table public.conversations (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('direct','group')),
 title text check (char_length(btrim(title)) between 1 and 60),
 direct_key text unique,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((kind = 'direct' and direct_key is not null and title is null) or (kind = 'group' and direct_key is null and title is not null))
);
create table public.conversation_members (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 last_read_at timestamptz not null default now(),
 primary key (conversation_id, user_id)
);
create index members_user_idx on public.conversation_members(user_id, conversation_id);
create table public.messages (
 id uuid primary key,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references public.profiles(id),
 body text not null check (char_length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now(),
 edited_at timestamptz,
 deleted_at timestamptz
);
create index messages_history_idx on public.messages(conversation_id, created_at desc, id desc);

create function private.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.conversation_members where conversation_id = cid and user_id = (select auth.uid()));
$$;
revoke all on function private.is_member(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy conversations_read on public.conversations for select to authenticated using (private.is_member(id));
create policy members_read on public.conversation_members for select to authenticated using (private.is_member(conversation_id));
create policy messages_read on public.messages for select to authenticated using (private.is_member(conversation_id));
revoke all on public.profiles, public.conversations, public.conversation_members, public.messages from anon, authenticated;
grant select on public.profiles, public.conversations, public.conversation_members, public.messages to authenticated;

-- Auth profile creation never trusts a caller-supplied account ID.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare chosen_name text; chosen_username text;
begin
 chosen_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', 'New friend')), 50);
 if chosen_name = '' then chosen_name := 'New friend'; end if;
 chosen_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
 if chosen_username !~ '^[a-z0-9_]{3,24}$' then
  raise exception 'Choose a username with 3–24 lowercase letters, numbers, or underscores';
 end if;
 insert into public.profiles(id, display_name, username) values (new.id, chosen_name, chosen_username);
 return new;
end; $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create function public.start_conversation(member_ids uuid[], group_title text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); others uuid[]; cid uuid; dkey text; n integer;
begin
 if me is null then raise exception 'Sign in to start a conversation'; end if;
 select array_agg(distinct x order by x) into others from unnest(member_ids) x where x is not null and x <> me;
 n := coalesce(cardinality(others),0);
 if n < 1 or n > 19 then raise exception 'Choose between 1 and 19 people'; end if;
 if (select count(*) from public.profiles where id = any(others)) <> n then raise exception 'A selected user no longer exists'; end if;
 if group_title is null then
  if n <> 1 then raise exception 'A direct conversation needs exactly two people'; end if;
  dkey := least(me::text, others[1]::text) || ':' || greatest(me::text, others[1]::text);
  insert into public.conversations(kind, direct_key, created_by) values ('direct', dkey, me)
   on conflict (direct_key) do update set direct_key = excluded.direct_key returning id into cid;
 else
  if char_length(btrim(group_title)) not between 1 and 60 then raise exception 'Circle name must be 1–60 characters'; end if;
  insert into public.conversations(kind, title, created_by) values ('group', btrim(group_title), me) returning id into cid;
 end if;
 insert into public.conversation_members(conversation_id, user_id)
 select cid, x from unnest(array_append(others,me)) x on conflict do nothing;
 return cid;
end; $$;

create function public.send_message(conversation uuid, message_id uuid, message_body text) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); result public.messages;
begin
 if me is null or not private.is_member(conversation) then raise exception 'Conversation unavailable'; end if;
 if message_body is null or char_length(btrim(message_body)) not between 1 and 4000 then raise exception 'Messages must contain 1–4000 characters'; end if;
 -- A retry of the same UUID is safe; it cannot overwrite an existing message.
 select * into result from public.messages where id = message_id;
 if found then
  if result.sender_id <> me or result.conversation_id <> conversation or result.body <> btrim(message_body) then
   raise exception 'Message identifier already used';
  end if;
  return result;
 end if;
 insert into public.messages(id, conversation_id, sender_id, body)
 values (message_id, conversation, me, btrim(message_body)) on conflict (id) do nothing returning * into result;
 if result.id is null then
  select * into result from public.messages where id = message_id;
  if result.sender_id <> me or result.conversation_id <> conversation or result.body <> btrim(message_body) then raise exception 'Message identifier already used'; end if;
 end if;
 update public.conversations set updated_at = now() where id = conversation;
 return result;
end; $$;

create function public.mark_read(conversation uuid, read_through timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not private.is_member(conversation) then raise exception 'Conversation unavailable'; end if;
 if read_through is null then raise exception 'Read timestamp is required'; end if;
 update public.conversation_members set last_read_at = least(read_through, now())
 where conversation_id = conversation and user_id = auth.uid() and last_read_at < least(read_through, now());
end; $$;

create function public.edit_message(message_id uuid, message_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to edit a message'; end if;
 if message_body is null or char_length(btrim(message_body)) not between 1 and 4000 then raise exception 'Messages must contain 1–4000 characters'; end if;
 update public.messages set body = btrim(message_body), edited_at = now()
 where id = message_id and sender_id = auth.uid() and deleted_at is null and private.is_member(conversation_id);
 if not found then raise exception 'Message unavailable'; end if;
end; $$;

create function public.delete_message(message_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to delete a message'; end if;
 update public.messages set body = 'Message deleted', deleted_at = now()
 where id = message_id and sender_id = auth.uid() and deleted_at is null and private.is_member(conversation_id);
 if not found then raise exception 'Message unavailable'; end if;
end; $$;

create function public.update_profile(new_name text, new_bio text, new_color text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to update your profile'; end if;
 update public.profiles set display_name = btrim(new_name), bio = btrim(new_bio), color = new_color where id = auth.uid();
end; $$;

create function public.list_conversations() returns jsonb
language sql stable security invoker set search_path = '' as $$
 select coalesce(jsonb_agg(row_data order by sort_date desc), '[]'::jsonb) from (
 select c.updated_at sort_date, jsonb_build_object(
 'id', c.id, 'kind', c.kind, 'title', c.title, 'updated_at', c.updated_at,
 'members', (select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username, 'color', p.color, 'bio', p.bio, 'last_read_at', m.last_read_at))
  from public.conversation_members m join public.profiles p on p.id=m.user_id where m.conversation_id=c.id),
 'last_message', (select to_jsonb(msg) from public.messages msg where msg.conversation_id=c.id order by msg.created_at desc, msg.id desc limit 1),
 'unread', (select count(*) from public.messages msg join public.conversation_members mine on mine.conversation_id=msg.conversation_id and mine.user_id=auth.uid()
   where msg.conversation_id=c.id and msg.sender_id<>auth.uid() and msg.created_at>mine.last_read_at)
 ) row_data from public.conversations c
 ) data;
$$;

create function public.message_history(conversation uuid, before_time timestamptz default null, before_id uuid default null) returns setof public.messages
language plpgsql stable security invoker set search_path = '' as $$
begin
 if (before_time is null) <> (before_id is null) then raise exception 'Supply both history cursor values'; end if;
 return query select * from public.messages where conversation_id = conversation
 and (before_time is null or (created_at,id) < (before_time, before_id))
 order by created_at desc, id desc limit 50;
end; $$;

create function public.search_messages(conversation uuid, query text) returns setof public.messages
language sql stable security invoker set search_path = '' as $$
 select * from public.messages where conversation_id = conversation and deleted_at is null
 and char_length(btrim(query)) >= 2 and position(lower(btrim(query)) in lower(body)) > 0
 order by created_at desc, id desc limit 100;
$$;

-- Grant only explicit RPCs. No client receives direct write access to tables.
revoke all on function public.start_conversation(uuid[],text), public.send_message(uuid,uuid,text),
 public.mark_read(uuid,timestamptz), public.edit_message(uuid,text), public.delete_message(uuid),
 public.update_profile(text,text,text), public.list_conversations(), public.message_history(uuid,timestamptz,uuid),
 public.search_messages(uuid,text) from public, anon;
grant execute on function public.start_conversation(uuid[],text), public.send_message(uuid,uuid,text),
 public.mark_read(uuid,timestamptz), public.edit_message(uuid,text), public.delete_message(uuid),
 public.update_profile(text,text,text), public.list_conversations(), public.message_history(uuid,timestamptz,uuid),
 public.search_messages(uuid,text) to authenticated;

-- Private channels carry ephemeral typing / presence only. Message bodies use Postgres Changes.
create policy kindred_updates_read on realtime.messages for select to authenticated
 using (realtime.topic() = 'updates:' || (select auth.uid())::text);

create policy kindred_realtime_read on realtime.messages for select to authenticated
 using (extension in ('broadcast','presence') and exists (
  select 1 from public.conversation_members m where m.user_id = auth.uid()
  and realtime.topic() = 'conversation:' || m.conversation_id::text
 ));
create policy kindred_realtime_write on realtime.messages for insert to authenticated
 with check (extension in ('broadcast','presence') and exists (
  select 1 from public.conversation_members m where m.user_id = auth.uid()
  and realtime.topic() = 'conversation:' || m.conversation_id::text
 ));

alter publication supabase_realtime add table public.messages, public.conversations, public.conversation_members, public.profiles;
commit;
