-- Run after 001_kindred.sql. Email-backed discovery with deliberately separate identities.
begin;
create function private.email_verified() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email is not null and btrim(email)<>'' and email_confirmed_at is not null);
$$;
revoke all on function private.email_verified() from public,anon;
grant execute on function private.email_verified() to authenticated;
create function private.require_email() returns void language plpgsql stable security definer set search_path='' as $$
begin if not private.email_verified() then raise exception 'Confirm your email address before continuing'; end if; end; $$;
revoke all on function private.require_email() from public,anon,authenticated;
create function public.account_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email_verified',private.email_verified());
$$;
revoke all on function public.account_status() from public,anon;
grant execute on function public.account_status() to authenticated;

-- Email is required; optional profile metadata has safe defaults.
create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare n text; u text;
begin
 if new.email is null or btrim(new.email)='' then raise exception 'An email address is required'; end if;
 n:=left(btrim(coalesce(new.raw_user_meta_data->>'display_name','New friend')),50);
 if n='' then n:='New friend'; end if;
 u:=lower(coalesce(new.raw_user_meta_data->>'username',''));
 if u='' then u:='member_'||left(replace(gen_random_uuid()::text,'-',''),16); end if;
 if u !~ '^[a-z0-9_]{3,24}$' then raise exception 'Choose a valid username'; end if;
 insert into public.profiles(id,display_name,username) values(new.id,n,u);return new;
end; $$;
create or replace function private.is_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.email_verified() and exists(select 1 from public.conversation_members where conversation_id=cid and user_id=auth.uid());
$$;
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(private.email_verified());
alter function public.start_conversation(uuid[],text) set schema private;
revoke all on function private.start_conversation(uuid[],text) from public,anon,authenticated;
create function public.start_conversation(member_ids uuid[],group_title text default null) returns uuid language plpgsql security definer set search_path='' as $$
begin perform private.require_email();return private.start_conversation(member_ids,group_title);end; $$;
revoke all on function public.start_conversation(uuid[],text) from public,anon;
grant execute on function public.start_conversation(uuid[],text) to authenticated;

create or replace function public.update_profile(new_name text,new_bio text,new_color text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_email();update public.profiles set display_name=btrim(new_name),bio=btrim(new_bio),color=new_color where id=auth.uid();end; $$;

-- Only the normal profile is in the public directory. Anonymous settings never are.
alter table public.profiles add column song_path text, add column song_title text not null default '' check(char_length(song_title)<=80);
create table private.personas(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 nickname text not null default 'Quiet comet' check(char_length(btrim(nickname)) between 1 and 40),
 bio text not null default '' check(char_length(bio)<=160),
 color text not null default 'lavender' check(color in ('fern','lavender','peach','blue','rose','amber')),
 song_path text, song_title text not null default '' check(char_length(song_title)<=80)
);
create table private.random_sessions(
 id uuid primary key default gen_random_uuid(),
 started_at timestamptz not null default now(), ended_at timestamptz
);
create table private.random_members(
 session_id uuid references private.random_sessions(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 persona_id uuid not null default gen_random_uuid() unique,
 anonymous boolean not null,
 profile jsonb not null,
 last_seen timestamptz not null default now(),
 feedback_done boolean not null default false,
 primary key(session_id,user_id)
);
create index random_user_idx on private.random_members(user_id,session_id);
create table private.match_queue(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 anonymous boolean not null, joined_at timestamptz not null default now(), heartbeat_at timestamptz not null default now()
);
create table private.random_messages(
 id uuid primary key,session_id uuid not null references private.random_sessions(id),
 sender_id uuid not null references public.profiles(id),body text not null check(char_length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now()
);
create index random_message_idx on private.random_messages(session_id,created_at,id);
create table private.conversation_ratings(
 session_id uuid references private.random_sessions(id), rater uuid references public.profiles(id),
 target uuid not null references public.profiles(id), score smallint not null check(score between 1 and 5),
 created_at timestamptz not null default now(),primary key(session_id,rater),check(rater<>target)
);
create table private.blocks(blocker uuid references public.profiles(id),target uuid references public.profiles(id),primary key(blocker,target),check(blocker<>target));
-- Defense in depth: none of these tables are exposed through PostgREST or granted to clients.
revoke all on all tables in schema private from public,anon,authenticated;
alter table private.personas enable row level security;
alter table private.random_sessions enable row level security;
alter table private.random_members enable row level security;
alter table private.match_queue enable row level security;
alter table private.random_messages enable row level security;
alter table private.conversation_ratings enable row level security;
alter table private.blocks enable row level security;

create function private.persona_snapshot(who uuid,anon_mode boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select case when anon_mode then jsonb_build_object('display_name',coalesce(a.nickname,'Quiet comet'),'bio',coalesce(a.bio,''),'color',coalesce(a.color,'lavender'),'song_path',a.song_path,'song_title',coalesce(a.song_title,''),'anonymous',true)
 else jsonb_build_object('display_name',p.display_name,'username',p.username,'bio',p.bio,'color',p.color,'song_path',p.song_path,'song_title',p.song_title,'anonymous',false) end
 from public.profiles p left join private.personas a on a.user_id=p.id where p.id=who;
$$;
create function public.my_personas() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform private.require_email();return jsonb_build_object('normal',private.persona_snapshot(auth.uid(),false),'anonymous',private.persona_snapshot(auth.uid(),true));end; $$;

-- Audio objects are opaque random filenames, never account IDs. Each persona gets its own upload.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('profile-music','profile-music',true,10485760,array['audio/mpeg','audio/ogg','audio/wav','audio/x-wav','audio/mp4']) on conflict(id) do nothing;
create policy music_upload on storage.objects for insert to authenticated with check(
 bucket_id='profile-music' and private.email_verified() and owner_id=auth.uid()::text
 and name ~ '^[0-9a-f-]{36}\.(mp3|ogg|wav|m4a)$');
create policy music_owner_read on storage.objects for select to authenticated using(bucket_id='profile-music' and owner_id=auth.uid()::text);
create policy music_owner_delete on storage.objects for delete to authenticated using(bucket_id='profile-music' and owner_id=auth.uid()::text);
create function public.save_persona(anon_mode boolean,new_name text,new_bio text,new_color text,new_song_path text default null,new_song_title text default '') returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_email();
 if anon_mode is null or new_name is null or char_length(btrim(new_name)) not between 1 and 40 or new_bio is null or char_length(new_bio)>160 or new_color is null or new_color not in ('fern','lavender','peach','blue','rose','amber') or new_song_title is null or char_length(new_song_title)>80 then raise exception 'Check the profile fields'; end if;
 if new_song_path is not null and not exists(select 1 from storage.objects where bucket_id='profile-music' and name=new_song_path and owner_id=auth.uid()::text) then raise exception 'Upload your own audio file';end if;
 if new_song_path is not null and ((anon_mode and exists(select 1 from public.profiles where id=auth.uid() and song_path=new_song_path)) or (not anon_mode and exists(select 1 from private.personas where user_id=auth.uid() and song_path=new_song_path))) then raise exception 'Upload a separate copy for each profile';end if;
 if anon_mode then insert into private.personas(user_id,nickname,bio,color,song_path,song_title) values(auth.uid(),btrim(new_name),btrim(new_bio),new_color,new_song_path,btrim(new_song_title)) on conflict(user_id) do update set nickname=excluded.nickname,bio=excluded.bio,color=excluded.color,song_path=excluded.song_path,song_title=excluded.song_title;
 else update public.profiles set display_name=btrim(new_name),bio=btrim(new_bio),color=new_color,song_path=new_song_path,song_title=btrim(new_song_title) where id=auth.uid();end if;
end; $$;

-- Latest vote from each distinct peer; a Bayesian prior limits the effect of one rating.
create function private.match_score(who uuid) returns numeric language sql stable security definer set search_path='' as $$
 select (17.5+coalesce(sum(score),0))/(5+count(*)) from(
 select distinct on(rater) score from private.conversation_ratings where target=who and created_at>now()-interval '90 days' order by rater,created_at desc,session_id desc) votes;
$$;
create function private.match_band(who uuid) returns integer language sql stable security definer set search_path='' as $$
 select case when (select count(distinct rater) from private.conversation_ratings where target=who and created_at>now()-interval '90 days')>=5 and private.match_score(who)<2.6 then 1 else 0 end;
$$;
create function private.notify_random(sid uuid) returns void language plpgsql security definer set search_path='' as $$
declare who uuid;begin
 for who in select user_id from private.random_members where session_id=sid loop
 perform realtime.send(jsonb_build_object('changed',true),'random_changed','discover:'||who::text,true);
 end loop;
end; $$;
create policy discover_read on realtime.messages for select to authenticated using(private.email_verified() and realtime.topic()='discover:'||(select auth.uid())::text);

create function public.random_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();sid uuid;session_row private.random_sessions;self_row private.random_members;peer_row private.random_members;
begin
 perform private.require_email();
 -- Common short lock serializes match, cancel and end operations, preventing double assignment.
 perform pg_advisory_xact_lock(729401);
 select s.id into sid from private.random_sessions s join private.random_members m on m.session_id=s.id where m.user_id=me and (s.ended_at is null or not m.feedback_done) order by s.started_at desc limit 1;
 if sid is null then
  if exists(select 1 from private.match_queue where user_id=me and heartbeat_at>now()-interval '45 seconds') then update private.match_queue set heartbeat_at=now() where user_id=me;return jsonb_build_object('status','waiting');end if;
  delete from private.match_queue where user_id=me;return jsonb_build_object('status','idle');
 end if;
 select * into session_row from private.random_sessions where id=sid;
 select * into self_row from private.random_members where session_id=sid and user_id=me;
 select * into peer_row from private.random_members where session_id=sid and user_id<>me;
 if session_row.ended_at is null and (self_row.last_seen<now()-interval '90 seconds' or peer_row.last_seen<now()-interval '90 seconds') then
  update private.random_sessions set ended_at=now() where id=sid;session_row.ended_at:=now();perform private.notify_random(sid);
 end if;
 update private.random_members set last_seen=now() where session_id=sid and user_id=me;
 return jsonb_build_object('status',case when session_row.ended_at is null then 'matched' else 'ended' end,'session_id',sid,'self_id',self_row.persona_id,'self_profile',self_row.profile,'peer',peer_row.profile||jsonb_build_object('id',peer_row.persona_id),'started_at',session_row.started_at,'ended_at',session_row.ended_at,'feedback_done',self_row.feedback_done);
end; $$;

create function public.join_random(anon_mode boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();peer uuid;peer_mode boolean;sid uuid;current_state jsonb;
begin
 perform private.require_email();if anon_mode is null then raise exception 'Choose a profile';end if;
 perform pg_advisory_xact_lock(729401);
 current_state:=public.random_state();
 if current_state->>'status' in ('matched','ended') then return current_state;end if;
 delete from private.match_queue where heartbeat_at<now()-interval '45 seconds';
 -- Expired sessions no longer reserve accounts, even if the abandoned tab never returns.
 update private.random_sessions s set ended_at=now() where s.ended_at is null and exists(select 1 from private.random_members m where m.session_id=s.id and m.last_seen<now()-interval '90 seconds');
 select q.user_id,q.anonymous into peer,peer_mode from private.match_queue q
 where q.user_id<>me and q.heartbeat_at>now()-interval '45 seconds'
 and not exists(select 1 from private.blocks b where (b.blocker=me and b.target=q.user_id) or (b.blocker=q.user_id and b.target=me))
 and not exists(select 1 from private.random_members a join private.random_members b on b.session_id=a.session_id join private.random_sessions s on s.id=a.session_id where a.user_id=me and b.user_id=q.user_id and s.started_at>now()-interval '24 hours')
 and not exists(select 1 from private.random_members m join private.random_sessions s on s.id=m.session_id where m.user_id=q.user_id and (s.ended_at is null or not m.feedback_done))
 and private.match_band(q.user_id)=private.match_band(me)
 order by abs(private.match_score(q.user_id)-private.match_score(me))+random()*0.5, q.joined_at limit 1;
 if peer is null then
 insert into private.match_queue(user_id,anonymous) values(me,anon_mode) on conflict(user_id) do update set anonymous=excluded.anonymous,heartbeat_at=now();
 return jsonb_build_object('status','waiting');
 end if;
 insert into private.random_sessions default values returning id into sid;
 insert into private.random_members(session_id,user_id,anonymous,profile) values(sid,me,anon_mode,private.persona_snapshot(me,anon_mode)),(sid,peer,peer_mode,private.persona_snapshot(peer,peer_mode));
 delete from private.match_queue where user_id in(me,peer);
 perform private.notify_random(sid);return public.random_state();
end; $$;
create function public.cancel_random() returns void language plpgsql security definer set search_path='' as $$
begin perform private.require_email();perform pg_advisory_xact_lock(729401);delete from private.match_queue where user_id=auth.uid();end; $$;
create function public.end_random(session uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_email();perform pg_advisory_xact_lock(729401);
 if not exists(select 1 from private.random_members where session_id=session and user_id=auth.uid()) then raise exception 'Conversation unavailable';end if;
 update private.random_sessions set ended_at=coalesce(ended_at,now()) where id=session;perform private.notify_random(session);
end; $$;
create function public.rate_random(session uuid,rating integer default null,block_peer boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare peer uuid;done boolean;begin
 perform private.require_email();perform pg_advisory_xact_lock(729401);
 select m.feedback_done into done from private.random_members m join private.random_sessions s on s.id=m.session_id where m.session_id=session and m.user_id=auth.uid() and s.ended_at is not null;
 if not found then raise exception 'End the conversation before rating';end if;
 if done then raise exception 'Feedback has already been submitted';end if;
 if rating is not null and rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5';end if;
 select user_id into peer from private.random_members where session_id=session and user_id<>auth.uid();
 if rating is not null then insert into private.conversation_ratings(session_id,rater,target,score) values(session,auth.uid(),peer,rating);end if;
 if block_peer is true then insert into private.blocks values(auth.uid(),peer) on conflict do nothing;end if;
 update private.random_members set feedback_done=true where session_id=session and user_id=auth.uid();
end; $$;
create function public.random_history(session uuid,before_time timestamptz default null,before_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_email();
 if not exists(select 1 from private.random_members where session_id=session and user_id=auth.uid()) then raise exception 'Conversation unavailable';end if;
 if (before_time is null)<>(before_id is null) then raise exception 'Supply both cursor values';end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb) from(
 select msg.id,m.persona_id sender_id,msg.body,msg.created_at from private.random_messages msg join private.random_members m on m.user_id=msg.sender_id and m.session_id=msg.session_id where msg.session_id=session and (before_time is null or (msg.created_at,msg.id)<(before_time,before_id)) order by msg.created_at desc,msg.id desc limit 100) x);
end; $$;
create function public.send_random(session uuid,message_id uuid,message_body text) returns void language plpgsql security definer set search_path='' as $$
declare existing private.random_messages;begin
 perform private.require_email();perform pg_advisory_xact_lock(729401);
 if not exists(select 1 from private.random_members m join private.random_sessions s on s.id=m.session_id where m.session_id=session and m.user_id=auth.uid() and s.ended_at is null and not exists(select 1 from private.random_members other where other.session_id=session and other.last_seen<now()-interval '90 seconds')) then raise exception 'This conversation has ended';end if;
 if message_body is null or char_length(btrim(message_body)) not between 1 and 4000 then raise exception 'Messages must contain 1–4000 characters';end if;
 select * into existing from private.random_messages where id=message_id;
 if found then if existing.sender_id<>auth.uid() or existing.session_id<>session or existing.body<>btrim(message_body) then raise exception 'Message identifier already used';end if;return;end if;
 insert into private.random_messages(id,session_id,sender_id,body) values(message_id,session,auth.uid(),btrim(message_body));perform private.notify_random(session);
end; $$;

revoke all on function private.persona_snapshot(uuid,boolean),private.match_score(uuid),private.match_band(uuid),private.notify_random(uuid) from public,anon,authenticated;
revoke all on function public.my_personas(),public.save_persona(boolean,text,text,text,text,text),public.random_state(),public.join_random(boolean),public.cancel_random(),public.end_random(uuid),public.rate_random(uuid,integer,boolean),public.random_history(uuid,timestamptz,uuid),public.send_random(uuid,uuid,text) from public,anon;
grant execute on function public.my_personas(),public.save_persona(boolean,text,text,text,text,text),public.random_state(),public.join_random(boolean),public.cancel_random(),public.end_random(uuid),public.rate_random(uuid,integer,boolean),public.random_history(uuid,timestamptz,uuid),public.send_random(uuid,uuid,text) to authenticated;
create or replace function public.list_conversations() returns jsonb
language sql stable security invoker set search_path = '' as $$
 select coalesce(jsonb_agg(row_data order by sort_date desc), '[]'::jsonb) from (
 select c.updated_at sort_date, jsonb_build_object(
 'id', c.id, 'kind', c.kind, 'title', c.title, 'updated_at', c.updated_at,
 'members', (select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username, 'color', p.color, 'bio', p.bio, 'song_path',p.song_path,'song_title',p.song_title,'last_read_at', m.last_read_at))
  from public.conversation_members m join public.profiles p on p.id=m.user_id where m.conversation_id=c.id),
 'last_message', (select to_jsonb(msg) from public.messages msg where msg.conversation_id=c.id order by msg.created_at desc, msg.id desc limit 1),
 'unread', (select count(*) from public.messages msg join public.conversation_members mine on mine.conversation_id=msg.conversation_id and mine.user_id=auth.uid()
   where msg.conversation_id=c.id and msg.sender_id<>auth.uid() and msg.created_at>mine.last_read_at)
 ) row_data from public.conversations c
 ) data;
$$;


commit;
