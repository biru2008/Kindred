import assert from "node:assert/strict";
export async function testInterests(db, { as, value, check }) {
  let counter = 200;
  async function fresh() {
    await db.exec("reset role");
    const id = `00000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`;
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,'{}',$2,now())",
      [id, `interest${counter}@example.com`],
    );
    return id;
  }
  async function isolate() {
    await db.exec("reset role");
    await db.exec("delete from private.match_queue");
  }
  async function queue(id, tags, strict = false, stale = false) {
    await db.exec("reset role");
    await db.query(
      "insert into private.match_queue(user_id,anonymous,interests,shared_only,heartbeat_at) values($1,true,$2,$3,now()-$4::interval)",
      [id, tags, strict, stale ? "60 seconds" : "0 seconds"],
    );
  }
  async function join(id, tags, strict = false) {
    await as(id);
    return value("select public.join_random(true,$1::text[],$2) v", [
      tags,
      strict,
    ]);
  }
  await isolate();
  const requester = await fresh();
  await check(
    "Interest matching rejects invalid, null, oversized, and empty strict selections",
    async () => {
      for (const [tags, strict] of [
        [["<invalid>"], false],
        [null, false],
        [[null], false],
        [["Music", "Art", "Books", "Travel", "Food", "Pets"], false],
        [[], true],
      ]) {
        await assert.rejects(() => join(requester, tags, strict));
      }
    },
  );
  await check(
    "Queue preferences survive state refresh and tags are deduplicated",
    async () => {
      const state = await join(requester, ["Music", "Music", "Books"], true);
      assert.equal(state.status, "waiting");
      assert.deepEqual(state.search_interests, ["Books", "Music"]);
      const resumed = await value("select public.random_state() v");
      assert.deepEqual(resumed.search_interests, state.search_interests);
      assert.equal(resumed.shared_only, true);
    },
  );
  await isolate();
  const one = await fresh(),
    two = await fresh(),
    none = await fresh();
  await queue(none, ["Gaming"]);
  await queue(one, ["Music"]);
  await queue(two, ["Music", "Books"]);
  const match = await join(requester, ["Music", "Books"]);
  await check(
    "Available users sharing more interests are preferred",
    async () => {
      assert.equal(match.status, "matched");
      assert.deepEqual(match.peer.interests, ["Music", "Books"]);
      await as(two);
      assert.equal(
        (await value("select public.random_state() v")).session_id,
        match.session_id,
      );
    },
  );
  await check(
    "Interest snapshots preserve anonymous identity isolation",
    async () => {
      assert.ok(!JSON.stringify(match).includes(two));
      assert.equal(match.peer.phone, undefined);
      assert.equal(match.peer.username, undefined);
      assert.deepEqual(match.self_profile.interests, ["Books", "Music"]);
      const again = await join(requester, ["Gaming"], true);
      assert.equal(again.session_id, match.session_id);
      assert.deepEqual(again.self_profile.interests, ["Books", "Music"]);
    },
  );
  await isolate();
  const strict = await fresh(),
    unrelated = await fresh();
  await queue(unrelated, ["Gaming"]);
  await check(
    "Strict shared-interest search waits instead of pairing unrelated interests",
    async () => {
      assert.equal((await join(strict, ["Books"], true)).status, "waiting");
    },
  );
  await isolate();
  const open = await fresh(),
    strictPeer = await fresh();
  await queue(strictPeer, ["Books"], true);
  await check(
    "An open search honors the queued peer's strict preference",
    async () => {
      assert.equal((await join(open, ["Music"])).status, "waiting");
    },
  );
  await isolate();
  const fallback = await fresh(),
    fallbackPeer = await fresh();
  await queue(fallbackPeer, ["Gaming"]);
  await check(
    "Without strict filtering a user can connect when interests do not overlap",
    async () => {
      assert.equal((await join(fallback, ["Books"])).status, "matched");
    },
  );
  await isolate();
  const legacy = await fresh(),
    legacyPeer = await fresh();
  await queue(legacyPeer, []);
  await check(
    "The previous one-argument RPC still works during a rolling deployment",
    async () => {
      await as(legacy);
      assert.equal(
        (await value("select public.join_random(true) v")).status,
        "matched",
      );
    },
  );
  await isolate();
  const blocked = await fresh(),
    blockedPeer = await fresh(),
    allowed = await fresh();
  await queue(blockedPeer, ["Music", "Books"]);
  await queue(allowed, ["Books"]);
  await db.query("insert into private.blocks values($1,$2)", [
    blockedPeer,
    blocked,
  ]);
  await check(
    "Shared tags never bypass a block in either direction",
    async () => {
      const result = await join(blocked, ["Music", "Books"]);
      assert.deepEqual(result.peer.interests, ["Books"]);
      await as(allowed);
      assert.equal(
        (await value("select public.random_state() v")).session_id,
        result.session_id,
      );
    },
  );
  await isolate();
  const stale = await fresh(),
    stalePeer = await fresh();
  await queue(stalePeer, ["Art"], true, true);
  await check(
    "A stale shared-interest queue entry cannot become a ghost match",
    async () => {
      assert.equal((await join(stale, ["Art"], true)).status, "waiting");
    },
  );
  await check(
    "Matching preferences are private and cannot be directly read by clients",
    async () => {
      await assert.rejects(() =>
        db.query("select interests from private.match_queue"),
      );
      await assert.rejects(() =>
        db.query("select private.normalize_interests(array['Music'])"),
      );
      await as(null);
      await assert.rejects(() =>
        db.query("select public.join_random(true,array['Music'],false)"),
      );
    },
  );
}
