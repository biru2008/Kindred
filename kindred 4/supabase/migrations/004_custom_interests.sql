-- Run once after migrations 001, 002, and 003 in an existing project.
-- Existing preset tags keep their labels; custom tags match without case differences.
begin;
create or replace function private.normalize_interests(values_to_check text[]) returns text[]
language plpgsql immutable set search_path='' as $$
declare raw_tag text; normalized text; cleaned text[]:='{}'::text[];
begin
 if values_to_check is null or cardinality(values_to_check)>5 then
  raise exception 'Choose up to five interests';
 end if;
 foreach raw_tag in array values_to_check loop
  if raw_tag is null then raise exception 'Enter a valid interest tag';end if;
  normalized:=lower(btrim(regexp_replace(raw_tag,'[[:space:]]+',' ','g')));
  if char_length(normalized) not between 2 and 30 or normalized !~ '^[a-z0-9][a-z0-9 -]*[a-z0-9]$' then
   raise exception 'Tags need 2–30 letters or numbers; spaces and hyphens are allowed';
  end if;
  if normalized=any(array['music','gaming','books','movies','anime','art','coding','science','photography','travel','food','fitness','outdoors','study','philosophy','pets']) then
   normalized:=initcap(normalized);
  end if;
  if not normalized=any(cleaned) then cleaned:=array_append(cleaned,normalized);end if;
 end loop;
 return (select coalesce(array_agg(tag order by tag),'{}'::text[]) from unnest(cleaned) t(tag));
end; $$;
revoke all on function private.normalize_interests(text[]) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
