import assert from "node:assert/strict";
export async function testCustomInterests(db, { as, value, check }) {
  await db.exec("reset role");
  await db.exec("delete from private.match_queue");
  const a = "00000000-0000-4000-8000-000000000801",
    b = "00000000-0000-4000-8000-000000000802";
  for (const [id, email] of [
    [a, "custom801@example.com"],
    [b, "custom802@example.com"],
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,'{}',$2,now())",
      [id, email],
    );
  await as(a);
  await check(
    "Custom tags normalize case and repeated spaces, and deduplicate preset aliases",
    async () => {
      const state = await value(
        "select public.join_random(true,$1::text[],true) v",
        [["  Indie   Music  ", " MUSIC ", "music", "k-pop"]],
      );
      assert.deepEqual(state.search_interests, [
        "Music",
        "indie music",
        "k-pop",
      ]);
    },
  );
  await as(b);
  const result = await value(
    "select public.join_random(true,$1::text[],true) v",
    [["INDIE MUSIC"]],
  );
  await check(
    "Two distinct accounts match on a case-insensitive custom tag",
    async () => {
      assert.equal(result.status, "matched");
      assert.deepEqual(result.self_profile.interests, ["indie music"]);
      assert.deepEqual(result.peer.interests, [
        "Music",
        "indie music",
        "k-pop",
      ]);
      assert.ok(!JSON.stringify(result).includes(a));
      await as(a);
      assert.equal(
        (await value("select public.random_state() v")).session_id,
        result.session_id,
      );
    },
  );
  await check(
    "Database rejects blank, one-character, markup, punctuation, and overlong custom tags",
    async () => {
      for (const tag of [" ", "x", "<script>", "hello@world", "x".repeat(31)])
        await assert.rejects(() =>
          value("select public.join_random(true,$1::text[],false) v", [[tag]]),
        );
    },
  );
  await check(
    "Custom tag normalization remains unavailable to unauthenticated clients",
    async () => {
      await as(null);
      await assert.rejects(() =>
        db.query("select private.normalize_interests(array['astronomy'])"),
      );
      await assert.rejects(() =>
        db.query("select public.join_random(true,array['astronomy'],true)"),
      );
    },
  );
}
