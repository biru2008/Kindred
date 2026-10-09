-- Apply once after migrations 001–007. Preserves existing accounts and conversations.
begin;
alter table private.random_sessions add column end_reason text check(end_reason in ('left','connection_lost'));
alter table private.random_sessions add column ended_by uuid references public.profiles(id) on delete set null;
alter table private.random_members add column connect_decision text not null default 'none' check(connect_decision in ('none','accepted','declined'));
create table private.random_connections(
 session_id uuid primary key references private.random_sessions(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table private.random_feedback(
 session_id uuid references private.random_sessions(id) on delete cascade,
 rater uuid references public.profiles(id) on delete cascade,
 category text not null check(category in ('general','good','not_vibe','technical','harassment','spam','inappropriate')),
 rating smallint check(rating between 1 and 5),created_at timestamptz not null default now(),
 primary key(session_id,rater)
);
-- Defense in depth: clients have neither table grants nor RLS policies.
alter table private.random_connections enable row level security;
alter table private.random_feedback enable row level security;
revoke all on private.random_connections,private.random_feedback from public,anon,authenticated;
-- Compatibility ratings remain, but ordinary mismatch/technical trouble cannot lower reputation.
create or replace function private.match_score(who uuid) returns numeric language sql stable security definer set search_path='' as $$
 select (17.5+coalesce(sum(score),0))/(5+count(*)) from(
 select distinct on(rater) score from private.conversation_ratings r where target=who and not exists(select 1 from private.random_feedback f where f.session_id=r.session_id and f.rater=r.rater and f.category in ('not_vibe','technical')) and created_at>now()-interval '90 days' order by rater,created_at desc,session_id desc) votes;
$$;
create or replace function private.match_band(who uuid) returns integer language sql stable security definer set search_path='' as $$
 select case when (select count(distinct rater) from private.conversation_ratings r where target=who and not exists(select 1 from private.random_feedback f where f.session_id=r.session_id and f.rater=r.rater and f.category in ('not_vibe','technical')) and created_at>now()-interval '90 days')>=5 and private.match_score(who)<2.6 then 1 else 0 end;
$$;

create function private.connection_snapshot(sid uuid,me uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('self',mine.connect_decision,'peer',peer.connect_decision,
 'conversation_id',case when mine.connect_decision='accepted' and peer.connect_decision='accepted' then c.conversation_id end)
 from private.random_members mine join private.random_members peer on peer.session_id=mine.session_id and peer.user_id<>mine.user_id
 left join private.random_connections c on c.session_id=mine.session_id
 where mine.session_id=sid and mine.user_id=me;
$$;
create or replace function public.random_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();sid uuid;s private.random_sessions;mine private.random_members;peer private.random_members;remaining integer;
begin
 perform private.require_email();perform pg_advisory_xact_lock(729401);
 select x.id into sid from private.random_sessions x join private.random_members m on m.session_id=x.id
 where m.user_id=me and (x.ended_at is null or not m.feedback_done) order by x.started_at desc limit 1;
 if sid is null then
  if exists(select 1 from private.match_queue where user_id=me and heartbeat_at>now()-interval '45 seconds') then
   update private.match_queue set heartbeat_at=now() where user_id=me;
   return (select jsonb_build_object('status','waiting','search_interests',q.interests,'shared_only',q.shared_only) from private.match_queue q where q.user_id=me);
  end if;
  delete from private.match_queue where user_id=me;return jsonb_build_object('status','idle');
 end if;
 select * into s from private.random_sessions where id=sid;
 select * into mine from private.random_members where session_id=sid and user_id=me;
 select * into peer from private.random_members where session_id=sid and user_id<>me;
 -- An expired session never revives. Heartbeats younger than 120s may resume normally.
 if s.ended_at is null and (mine.last_seen<now()-interval '120 seconds' or peer.last_seen<now()-interval '120 seconds') then
  update private.random_sessions set ended_at=now(),end_reason='connection_lost' where id=sid returning * into s;
  perform private.notify_random(sid);
 end if;
 update private.random_members set last_seen=now() where session_id=sid and user_id=me;
 remaining:=greatest(0,ceil(extract(epoch from(peer.last_seen+interval '120 seconds'-now())))::integer);
 return jsonb_build_object('status',case when s.ended_at is null then 'matched' else 'ended' end,
 'session_id',sid,'self_id',mine.persona_id,'self_profile',mine.profile,'peer',peer.profile||jsonb_build_object('id',peer.persona_id),
 'started_at',s.started_at,'ended_at',s.ended_at,'feedback_done',mine.feedback_done,
 'end_reason',s.end_reason,'ended_by_you',s.ended_by=me,
 'peer_connection',case when s.ended_at is not null then 'ended' when peer.last_seen<now()-interval '25 seconds' then 'reconnecting' else 'active' end,
 'peer_grace_seconds',remaining,'connection',private.connection_snapshot(sid,me));
end; $$;
create function public.random_heartbeat() returns void language plpgsql security definer set search_path='' as $$
begin perform public.random_state();end; $$;
create or replace function public.join_random(anon_mode boolean, interests text[], shared_only boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();peer uuid;peer_mode boolean;sid uuid;current_state jsonb; selected text[]; peer_interests text[]; strict_matching boolean:=shared_only;
begin
 perform private.require_email();selected:=private.normalize_interests(interests);if strict_matching is null then raise exception 'Choose a matching preference';end if;if strict_matching and cardinality(selected)=0 then raise exception 'Choose at least one interest for shared-interest matching';end if;if anon_mode is null then raise exception 'Choose a profile';end if;
 perform pg_advisory_xact_lock(729401);
 current_state:=public.random_state();
 if current_state->>'status' in ('matched','ended') then return current_state;end if;
 delete from private.match_queue where heartbeat_at<now()-interval '45 seconds';
 -- Expired sessions no longer reserve accounts, even if the abandoned tab never returns.
 update private.random_sessions s set ended_at=now(),end_reason='connection_lost' where s.ended_at is null and exists(select 1 from private.random_members m where m.session_id=s.id and m.last_seen<now()-interval '120 seconds');
 select q.user_id,q.anonymous,q.interests into peer,peer_mode,peer_interests from private.match_queue q
 where q.user_id<>me and q.heartbeat_at>now()-interval '45 seconds'
 and not exists(select 1 from private.blocks b where (b.blocker=me and b.target=q.user_id) or (b.blocker=q.user_id and b.target=me))
 and not exists(select 1 from private.random_members a join private.random_members b on b.session_id=a.session_id join private.random_sessions s on s.id=a.session_id where a.user_id=me and b.user_id=q.user_id and s.started_at>now()-interval '24 hours')
 and not exists(select 1 from private.random_members m join private.random_sessions s on s.id=m.session_id where m.user_id=q.user_id and (s.ended_at is null or not m.feedback_done))
 and private.match_band(q.user_id)=private.match_band(me)
 and (not (strict_matching or q.shared_only) or q.interests && selected)
 order by (select count(*) from unnest(q.interests) t(tag) where tag=any(selected)) desc, abs(private.match_score(q.user_id)-private.match_score(me))+random()*0.5, q.joined_at limit 1;
 if peer is null then
 insert into private.match_queue(user_id,anonymous,interests,shared_only) values(me,anon_mode,selected,strict_matching) on conflict(user_id) do update set anonymous=excluded.anonymous,interests=excluded.interests,shared_only=excluded.shared_only,heartbeat_at=now();
 return jsonb_build_object('status','waiting','search_interests',selected,'shared_only',strict_matching);
 end if;
 insert into private.random_sessions default values returning id into sid;
 insert into private.random_members(session_id,user_id,anonymous,profile) values(sid,me,anon_mode,private.persona_snapshot(me,anon_mode)||jsonb_build_object('interests',selected)),(sid,peer,peer_mode,private.persona_snapshot(peer,peer_mode)||jsonb_build_object('interests',peer_interests));
 delete from private.match_queue where user_id in(me,peer);
 perform private.notify_random(sid);return public.random_state();
end; $$;


create or replace function public.end_random(session uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_email();perform pg_advisory_xact_lock(729401);
 if not exists(select 1 from private.random_members where session_id=session and user_id=auth.uid()) then raise exception 'Conversation unavailable';end if;
 update private.random_sessions set ended_at=now(),end_reason='left',ended_by=auth.uid() where id=session and ended_at is null;
 perform private.notify_random(session);
end; $$;
create function public.connect_random(session uuid,decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();peer uuid;cid uuid;mine private.random_members;other private.random_members;
begin
 perform private.require_email();perform pg_advisory_xact_lock(729401);
 if decision is null or decision not in ('accepted','declined','none') then raise exception 'Choose a connection response';end if;
 select * into mine from private.random_members where session_id=session and user_id=me;
 select * into other from private.random_members where session_id=session and user_id<>me;
 if mine.user_id is null or other.user_id is null then raise exception 'Conversation unavailable';end if;
 select conversation_id into cid from private.random_connections where session_id=session;
 if cid is not null then return private.connection_snapshot(session,me);end if;
 if mine.feedback_done or other.feedback_done or not exists(select 1 from private.random_sessions where id=session and started_at>now()-interval '24 hours') then raise exception 'This connection request has closed';end if;
 if exists(select 1 from private.blocks where (blocker=me and target=other.user_id) or (blocker=other.user_id and target=me)) then raise exception 'Connection unavailable';end if;
 if mine.connect_decision='declined' or other.connect_decision='declined' then raise exception 'This connection request was declined';end if;
 update private.random_members set connect_decision=decision where session_id=session and user_id=me;
 if decision='accepted' and other.connect_decision='accepted' then
  -- Only explicit consent from both members permits exposing regular profiles through a DM.
  cid:=public.start_conversation(array[other.user_id]);
  insert into private.random_connections(session_id,conversation_id) values(session,cid);
 end if;
 perform private.notify_random(session);return private.connection_snapshot(session,me);
end; $$;
create function public.submit_random_feedback(session uuid,rating integer,category text,block_peer boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare peer uuid;done boolean;effective integer;
begin
 perform private.require_email();perform pg_advisory_xact_lock(729401);
 select m.feedback_done into done from private.random_members m join private.random_sessions s on s.id=m.session_id where m.session_id=session and m.user_id=auth.uid() and s.ended_at is not null;
 if not found then raise exception 'End the conversation before rating';end if;
 if done then raise exception 'Feedback has already been submitted';end if;
 if category is null or category not in ('general','good','not_vibe','technical','harassment','spam','inappropriate') then raise exception 'Choose a feedback category';end if;
 if rating is not null and rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5';end if;
 if block_peer is null then raise exception 'Choose a blocking preference';end if;
 select user_id into peer from private.random_members where session_id=session and user_id<>auth.uid();
 insert into private.random_feedback(session_id,rater,category,rating) values(session,auth.uid(),category,rating);
 effective:=case when category in ('harassment','spam','inappropriate') then 1 else rating end;
 if effective is not null then insert into private.conversation_ratings(session_id,rater,target,score) values(session,auth.uid(),peer,effective);end if;
 if block_peer then insert into private.blocks values(auth.uid(),peer) on conflict do nothing;end if;
 -- Leaving closes any request that did not receive both people's consent.
 if not exists(select 1 from private.random_connections where session_id=session) then update private.random_members set connect_decision='declined' where session_id=session and user_id=auth.uid();end if;
 update private.random_members set feedback_done=true where session_id=session and user_id=auth.uid();
 perform private.notify_random(session);
end; $$;
create or replace function public.rate_random(session uuid,rating integer default null,block_peer boolean default false) returns void
language sql security definer set search_path='' as $$
 select public.submit_random_feedback(session,rating,'general',block_peer);
$$;
create or replace function public.send_random(session uuid,message_id uuid,message_body text) returns void language plpgsql security definer set search_path='' as $$
declare existing private.random_messages;begin
 perform private.require_email();perform pg_advisory_xact_lock(729401);
 if not exists(select 1 from private.random_members m join private.random_sessions s on s.id=m.session_id where m.session_id=session and m.user_id=auth.uid() and s.ended_at is null and not exists(select 1 from private.random_members other where other.session_id=session and other.last_seen<now()-interval '120 seconds')) then raise exception 'This conversation has ended';end if;
 if message_body is null or char_length(btrim(message_body)) not between 1 and 4000 then raise exception 'Messages must contain 1–4000 characters';end if;
 select * into existing from private.random_messages where id=message_id;
 if found then if existing.sender_id<>auth.uid() or existing.session_id<>session or existing.body<>btrim(message_body) then raise exception 'Message identifier already used';end if;return;end if;
 insert into private.random_messages(id,session_id,sender_id,body) values(message_id,session,auth.uid(),btrim(message_body));perform private.notify_random(session);
end; $$;

revoke all on function private.connection_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.random_heartbeat(),public.connect_random(uuid,text),public.submit_random_feedback(uuid,integer,text,boolean) from public,anon;
grant execute on function public.random_heartbeat(),public.connect_random(uuid,text),public.submit_random_feedback(uuid,integer,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
