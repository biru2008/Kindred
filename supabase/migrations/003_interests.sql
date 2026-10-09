-- Existing projects: run only this migration after 001 and 002.
-- Keeps the legacy one-argument RPC working while adding tag-aware matching.
begin;
alter table private.match_queue add column interests text[] not null default '{}', add column shared_only boolean not null default false;
create function private.normalize_interests(values_to_check text[]) returns text[]
language plpgsql immutable set search_path='' as $$
declare cleaned text[];
begin
 if values_to_check is null or cardinality(values_to_check)>5 then raise exception 'Choose up to five interests';end if;
 if exists(select 1 from unnest(values_to_check) t(tag) where tag is null or tag<>all(array['Music','Gaming','Books','Movies','Anime','Art','Coding','Science','Photography','Travel','Food','Fitness','Outdoors','Study','Philosophy','Pets'])) then raise exception 'Choose an interest from the list';end if;
 select coalesce(array_agg(tag order by tag),'{}'::text[]) into cleaned from (select distinct tag from unnest(values_to_check) t(tag)) tags;
 return cleaned;
end; $$;
revoke all on function private.normalize_interests(text[]) from public,anon,authenticated;
create or replace function public.random_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();sid uuid;session_row private.random_sessions;self_row private.random_members;peer_row private.random_members;
begin
 perform private.require_email();
 -- Common short lock serializes match, cancel and end operations, preventing double assignment.
 perform pg_advisory_xact_lock(729401);
 select s.id into sid from private.random_sessions s join private.random_members m on m.session_id=s.id where m.user_id=me and (s.ended_at is null or not m.feedback_done) order by s.started_at desc limit 1;
 if sid is null then
  if exists(select 1 from private.match_queue where user_id=me and heartbeat_at>now()-interval '45 seconds') then update private.match_queue set heartbeat_at=now() where user_id=me;return (select jsonb_build_object('status','waiting','search_interests',q.interests,'shared_only',q.shared_only) from private.match_queue q where q.user_id=me);end if;
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

create function public.join_random(anon_mode boolean, interests text[], shared_only boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();peer uuid;peer_mode boolean;sid uuid;current_state jsonb; selected text[]; peer_interests text[]; strict_matching boolean:=shared_only;
begin
 perform private.require_email();selected:=private.normalize_interests(interests);if strict_matching is null then raise exception 'Choose a matching preference';end if;if strict_matching and cardinality(selected)=0 then raise exception 'Choose at least one interest for shared-interest matching';end if;if anon_mode is null then raise exception 'Choose a profile';end if;
 perform pg_advisory_xact_lock(729401);
 current_state:=public.random_state();
 if current_state->>'status' in ('matched','ended') then return current_state;end if;
 delete from private.match_queue where heartbeat_at<now()-interval '45 seconds';
 -- Expired sessions no longer reserve accounts, even if the abandoned tab never returns.
 update private.random_sessions s set ended_at=now() where s.ended_at is null and exists(select 1 from private.random_members m where m.session_id=s.id and m.last_seen<now()-interval '90 seconds');
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

create or replace function public.join_random(anon_mode boolean default true) returns jsonb
language sql security definer set search_path='' as $$
 select public.join_random(anon_mode,'{}'::text[],false);
$$;
revoke all on function public.join_random(boolean,text[],boolean) from public,anon;
grant execute on function public.join_random(boolean,text[],boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
