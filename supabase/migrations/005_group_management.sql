begin;
alter table public.conversation_members add column role text not null default 'member' check(role in ('owner','admin','member'));
update public.conversation_members m set role='owner' from public.conversations c where c.id=m.conversation_id and c.kind='group' and c.created_by=m.user_id;
create table public.group_invitations (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations on delete cascade,
 invitee uuid not null references public.profiles on delete cascade,
 invited_by uuid not null references public.profiles,
 status text not null default 'pending' check(status in ('pending','accepted','declined','revoked')),
 created_at timestamptz not null default now(), unique(conversation_id,invitee)
);
alter table public.group_invitations enable row level security;
revoke all on public.group_invitations from public,anon,authenticated;
grant select on public.group_invitations to authenticated;
create function private.group_role(cid uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.conversation_members m join public.conversations c on c.id=m.conversation_id where c.kind='group' and c.id=cid and m.user_id=auth.uid() and private.email_verified();
$$;
revoke all on function private.group_role(uuid) from public,anon;
grant execute on function private.group_role(uuid) to authenticated;
create policy invitations_read on public.group_invitations for select to authenticated using(private.email_verified() and (invitee=auth.uid() or private.group_role(conversation_id) in ('owner','admin')));
create function public.invite_group(conversation uuid, person uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_email();
 perform 1 from public.conversations where id=conversation and kind='group' for update;
 if private.group_role(conversation) not in ('owner','admin') or private.group_role(conversation) is null then raise exception 'Only circle owners and admins can invite'; end if;
 if exists(select 1 from public.conversation_members where conversation_id=conversation and user_id=person) then raise exception 'Already a member'; end if;
 if (select count(*) from public.conversation_members where conversation_id=conversation)+(select count(*) from public.group_invitations where conversation_id=conversation and status='pending') >=20 then raise exception 'Circle capacity is 20, including pending invitations'; end if;
 insert into public.group_invitations(conversation_id,invitee,invited_by) values(conversation,person,auth.uid()) on conflict(conversation_id,invitee) do update set status='pending',invited_by=excluded.invited_by,created_at=now();
end; $$;
create or replace function public.start_conversation(member_ids uuid[],group_title text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; person uuid;
begin
 perform private.require_email(); cid:=private.start_conversation(member_ids,group_title);
 if group_title is not null then
  update public.conversation_members set role='owner' where conversation_id=cid and user_id=auth.uid();
  delete from public.conversation_members where conversation_id=cid and user_id<>auth.uid();
  for person in select distinct x from unnest(member_ids) x where x is not null and x<>auth.uid() loop perform public.invite_group(cid,person); end loop;
 end if;
 return cid;
end; $$;
create function public.list_group_invitations() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'conversation_id',i.conversation_id,'title',c.title,'invitee',i.invitee,'name',p.display_name,'inviter',s.display_name,'status',i.status)), '[]'::jsonb)
 from public.group_invitations i join public.conversations c on c.id=i.conversation_id join public.profiles p on p.id=i.invitee join public.profiles s on s.id=i.invited_by
 where private.email_verified() and i.status='pending' and (i.invitee=auth.uid() or private.group_role(i.conversation_id) in ('owner','admin'));
$$;
create function public.respond_group_invitation(invitation uuid, accept boolean) returns void language plpgsql security definer set search_path='' as $$
declare inv public.group_invitations;
begin
 perform private.require_email();
 select * into inv from public.group_invitations where id=invitation;
 if inv.id is null then raise exception 'Invitation unavailable'; end if;
 perform 1 from public.conversations where id=inv.conversation_id for update;
 select * into inv from public.group_invitations where id=invitation for update;
 if inv.invitee<>auth.uid() or inv.status<>'pending' then raise exception 'Invitation unavailable'; end if;
 if accept then
  if (select count(*) from public.conversation_members where conversation_id=inv.conversation_id)>=20 then raise exception 'Circle is full'; end if;
  insert into public.conversation_members(conversation_id,user_id) values(inv.conversation_id,auth.uid());
 end if;
 update public.group_invitations set status=case when accept then 'accepted' else 'declined' end where id=invitation;
end; $$;
create function public.manage_group(conversation uuid, person uuid, action text) returns void language plpgsql security definer set search_path='' as $$
declare actor text; target text;
begin
 perform private.require_email();
 perform 1 from public.conversations where id=conversation and kind='group' for update;
 actor:=private.group_role(conversation);
 select role into target from public.conversation_members where conversation_id=conversation and user_id=person;
 if actor is null then raise exception 'Circle unavailable'; end if;
 if action='leave' and person=auth.uid() then
  if actor='owner' then raise exception 'Transfer ownership before leaving'; end if;
 elsif action='revoke' and actor in ('owner','admin') then
  update public.group_invitations set status='revoked' where conversation_id=conversation and invitee=person and status='pending'; return;
 elsif action in ('promote','demote','transfer') and actor='owner' and target is not null and person<>auth.uid() then
  if action='transfer' then update public.conversation_members set role='admin' where conversation_id=conversation and user_id=auth.uid(); end if;
  update public.conversation_members set role=case action when 'promote' then 'admin' when 'transfer' then 'owner' else 'member' end where conversation_id=conversation and user_id=person; return;
 elsif action='remove' and person<>auth.uid() and target='member' and actor in ('owner','admin') then null;
 elsif action='remove' and person<>auth.uid() and target='admin' and actor='owner' then null;
 else raise exception 'You cannot perform this circle action';
 end if;
 delete from public.conversation_members where conversation_id=conversation and user_id=person;
end; $$;
revoke all on function public.invite_group(uuid,uuid),public.list_group_invitations(),public.respond_group_invitation(uuid,boolean),public.manage_group(uuid,uuid,text) from public,anon;
grant execute on function public.invite_group(uuid,uuid),public.list_group_invitations(),public.respond_group_invitation(uuid,boolean),public.manage_group(uuid,uuid,text) to authenticated;
create or replace function public.list_conversations() returns jsonb
language sql stable security invoker set search_path = '' as $$
 select coalesce(jsonb_agg(row_data order by sort_date desc), '[]'::jsonb) from (
 select c.updated_at sort_date, jsonb_build_object(
 'id', c.id, 'kind', c.kind, 'title', c.title, 'updated_at', c.updated_at,
 'members', (select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username, 'color', p.color, 'bio', p.bio, 'song_path', p.song_path, 'song_title', p.song_title, 'last_read_at', m.last_read_at, 'role', m.role))
  from public.conversation_members m join public.profiles p on p.id=m.user_id where m.conversation_id=c.id),
 'last_message', (select to_jsonb(msg) from public.messages msg where msg.conversation_id=c.id order by msg.created_at desc, msg.id desc limit 1),
 'unread', (select count(*) from public.messages msg join public.conversation_members mine on mine.conversation_id=msg.conversation_id and mine.user_id=auth.uid()
   where msg.conversation_id=c.id and msg.sender_id<>auth.uid() and msg.created_at>mine.last_read_at)
 ) row_data from public.conversations c
 ) data;
$$;

alter publication supabase_realtime add table public.group_invitations;
commit;
