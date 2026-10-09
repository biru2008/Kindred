import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export async function testDiscoveryExperience(db, { C, as, value, check }) {
  await db.exec("reset role");
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/008_discovery_connections.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  let index = 1000;
  async function user() {
    const id = `60000000-0000-4000-8000-${String(++index).padStart(12, "0")}`;
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)",
      [
        id,
        `experience${index}@example.com`,
        JSON.stringify({
          username: `meet${index}`,
          display_name: `Regular ${index}`,
        }),
      ],
    );
    return id;
  }
  async function pair() {
    const a = await user(),
      b = await user(),
      tag = `connection ${index}`;
    await as(a);
    assert.equal(
      (
        await value("select public.join_random(true,$1::text[],true) v", [
          [tag],
        ])
      ).status,
      "waiting",
    );
    await as(b);
    const state = await value(
      "select public.join_random(true,$1::text[],true) v",
      [[tag]],
    );
    assert.equal(state.status, "matched");
    return { a, b, sid: state.session_id };
  }
  async function state(who) {
    await as(who);
    return value("select public.random_state() v");
  }
  const p = await pair();
  await check(
    "Discovery upgrade retains matching and anonymous per-session identities",
    async () => {
      const s = await state(p.a);
      assert.equal(s.peer_connection, "active");
      assert.deepEqual(s.connection, {
        self: "none",
        peer: "none",
        conversation_id: null,
      });
      assert.equal(JSON.stringify(s).includes(p.b), false);
      assert.equal(s.peer.username, undefined);
    },
  );
  await check(
    "A unilateral request cannot reveal the peer account or create a DM",
    async () => {
      await as(p.a);
      const c = await value("select public.connect_random($1,'accepted') v", [
        p.sid,
      ]);
      assert.equal(c.self, "accepted");
      assert.equal(c.conversation_id, null);
      assert.equal(
        (await value("select public.list_conversations() v")).length,
        0,
      );
      const s = await state(p.b);
      assert.equal(s.connection.peer, "accepted");
      assert.equal(JSON.stringify(s).includes(p.a), false);
    },
  );
  let cid;
  await check(
    "Explicit mutual consent creates exactly one authorized regular-profile DM",
    async () => {
      await as(p.b);
      cid = (
        await value("select public.connect_random($1,'accepted') v", [p.sid])
      ).conversation_id;
      assert.ok(cid);
      const chat = (await value("select public.list_conversations() v")).find(
        (c) => c.id === cid,
      );
      assert.equal(chat.members.length, 2);
      assert.ok(chat.members.some((m) => m.id === p.a));
      assert.equal(
        chat.members.some((m) => m.email),
        false,
      );
      await as(p.a);
      assert.equal(
        (await value("select public.connect_random($1,'accepted') v", [p.sid]))
          .conversation_id,
        cid,
      );
      assert.equal(
        (await value("select public.list_conversations() v")).length,
        1,
      );
      await as(C);
      assert.equal(
        (await value("select public.list_conversations() v")).some(
          (c) => c.id === cid,
        ),
        false,
      );
    },
  );
  await check(
    "Outsiders cannot call connection RPCs or read private requests and feedback",
    async () => {
      await as(C);
      await assert.rejects(() =>
        db.query("select public.connect_random($1,'accepted')", [p.sid]),
      );
      for (const table of ["random_connections", "random_feedback"])
        await assert.rejects(() => db.query(`select * from private.${table}`));
      await assert.rejects(() =>
        db.query("select private.connection_snapshot($1,$2)", [p.sid, p.a]),
      );
    },
  );
  const q = await pair();
  await check(
    "Cancellation and decline do not expose regular profiles or create a DM",
    async () => {
      await as(q.a);
      await db.query("select public.connect_random($1,'accepted')", [q.sid]);
      await db.query("select public.connect_random($1,'none')", [q.sid]);
      assert.equal((await state(q.b)).connection.peer, "none");
      await as(q.b);
      await db.query("select public.connect_random($1,'accepted')", [q.sid]);
      await as(q.a);
      await db.query("select public.connect_random($1,'declined')", [q.sid]);
      await as(q.b);
      await assert.rejects(() =>
        db.query("select public.connect_random($1,'accepted')", [q.sid]),
      );
      assert.equal(
        (await value("select public.list_conversations() v")).length,
        0,
      );
    },
  );
  const closed = await pair();
  await check(
    "Moving on closes unaccepted requests; blocks prevent connecting",
    async () => {
      await as(closed.a);
      await db.query("select public.connect_random($1,'accepted')", [
        closed.sid,
      ]);
      await db.query("select public.end_random($1)", [closed.sid]);
      await db.query(
        "select public.submit_random_feedback($1,null,'general',true)",
        [closed.sid],
      );
      await as(closed.b);
      await assert.rejects(() =>
        db.query("select public.connect_random($1,'accepted')", [closed.sid]),
      );
      assert.equal(
        (await value("select public.list_conversations() v")).length,
        0,
      );
    },
  );
  for (const category of ["not_vibe", "technical"]) {
    const r = await pair();
    await as(r.a);
    await db.query("select public.end_random($1)", [r.sid]);
    await check(
      `${category} feedback is private and cannot lower matching reputation`,
      async () => {
        await db.query("select public.submit_random_feedback($1,1,$2,false)", [
          r.sid,
          category,
        ]);
        await db.exec("reset role");
        assert.equal(
          Number(await value("select private.match_score($1) v", [r.b])),
          3.5,
        );
        assert.equal(await value("select private.match_band($1) v", [r.b]), 0);
        assert.equal(
          await value(
            "select category v from private.random_feedback where session_id=$1",
            [r.sid],
          ),
          category,
        );
        await as(r.b);
        await assert.rejects(() =>
          db.query("select * from private.random_feedback"),
        );
        assert.equal(
          JSON.stringify(
            await value("select public.random_state() v"),
          ).includes(category),
          false,
        );
      },
    );
  }
  const safety = await pair();
  await check(
    "Safety feedback works without a star rating and one vote cannot isolate a user",
    async () => {
      await as(safety.a);
      await db.query("select public.end_random($1)", [safety.sid]);
      await db.query(
        "select public.submit_random_feedback($1,null,'harassment',false)",
        [safety.sid],
      );
      await db.exec("reset role");
      assert.equal(
        await value(
          "select score v from private.conversation_ratings where session_id=$1",
          [safety.sid],
        ),
        1,
      );
      assert.equal(
        await value("select private.match_band($1) v", [safety.b]),
        0,
      );
    },
  );
  const invalid = await pair();
  await check(
    "Feedback validation, participant checks, and once-only submission are enforced",
    async () => {
      await as(invalid.a);
      await assert.rejects(() =>
        db.query("select public.submit_random_feedback($1,5,'good',false)", [
          invalid.sid,
        ]),
      );
      await db.query("select public.end_random($1)", [invalid.sid]);
      await assert.rejects(() =>
        db.query(
          "select public.submit_random_feedback($1,5,'invented',false)",
          [invalid.sid],
        ),
      );
      await assert.rejects(() =>
        db.query("select public.submit_random_feedback($1,7,'general',false)", [
          invalid.sid,
        ]),
      );
      await as(C);
      await assert.rejects(() =>
        db.query("select public.submit_random_feedback($1,5,'good',false)", [
          invalid.sid,
        ]),
      );
      await as(invalid.a);
      await db.query("select public.rate_random($1,5,false)", [invalid.sid]);
      await assert.rejects(() =>
        db.query("select public.submit_random_feedback($1,5,'good',false)", [
          invalid.sid,
        ]),
      );
    },
  );
  const reconnect = await pair();
  await check(
    "Temporary disconnect retains the same session, history, and grace period",
    async () => {
      await as(reconnect.a);
      await db.query(
        "select public.send_random($1,gen_random_uuid(),'Before disconnect')",
        [reconnect.sid],
      );
      await db.exec("reset role");
      await db.query(
        "update private.random_members set last_seen=now()-interval '60 seconds' where session_id=$1 and user_id=$2",
        [reconnect.sid, reconnect.b],
      );
      const s = await state(reconnect.a);
      assert.equal(s.status, "matched");
      assert.equal(s.peer_connection, "reconnecting");
      assert.ok(s.peer_grace_seconds > 50 && s.peer_grace_seconds <= 60);
      await db.query(
        "select public.send_random($1,gen_random_uuid(),'During grace')",
        [reconnect.sid],
      );
      assert.equal((await state(reconnect.b)).status, "matched");
      const resumed = await state(reconnect.a);
      assert.equal(resumed.session_id, reconnect.sid);
      assert.equal(resumed.peer_connection, "active");
      assert.equal(
        (await value("select public.random_history($1) v", [reconnect.sid]))
          .length,
        2,
      );
    },
  );
  await check(
    "Independent heartbeat refreshes liveness without exposing account identifiers",
    async () => {
      await db.exec("reset role");
      await db.query(
        "update private.random_members set last_seen=now()-interval '60 seconds' where session_id=$1 and user_id=$2",
        [reconnect.sid, reconnect.a],
      );
      await as(reconnect.a);
      await db.query("select public.random_heartbeat()");
      await db.exec("reset role");
      assert.ok(
        Number(
          await value(
            "select extract(epoch from(now()-last_seen)) v from private.random_members where session_id=$1 and user_id=$2",
            [reconnect.sid, reconnect.a],
          ),
        ) < 2,
      );
    },
  );
  const timedout = await pair();
  await check(
    "Expired connections end once with a clear reason and cannot revive or send",
    async () => {
      await db.exec("reset role");
      await db.query(
        "update private.random_members set last_seen=now()-interval '130 seconds' where session_id=$1 and user_id=$2",
        [timedout.sid, timedout.b],
      );
      const s = await state(timedout.a);
      assert.equal(s.status, "ended");
      assert.equal(s.end_reason, "connection_lost");
      const end = s.ended_at;
      assert.equal((await state(timedout.b)).ended_at, end);
      await assert.rejects(() =>
        db.query("select public.send_random($1,gen_random_uuid(),'Too late')", [
          timedout.sid,
        ]),
      );
      await db.query("select public.random_heartbeat()");
      assert.equal(
        (await value("select public.random_state() v")).status,
        "ended",
      );
    },
  );
  const ownTimeout = await pair();
  await check(
    "Returning after your own grace expired cannot silently revive a session",
    async () => {
      await db.exec("reset role");
      await db.query(
        "update private.random_members set last_seen=now()-interval '130 seconds' where session_id=$1 and user_id=$2",
        [ownTimeout.sid, ownTimeout.a],
      );
      assert.equal((await state(ownTimeout.a)).end_reason, "connection_lost");
    },
  );
  const left = await pair();
  await check(
    "An explicit departure is distinguished from a network timeout",
    async () => {
      await as(left.a);
      await db.query("select public.end_random($1)", [left.sid]);
      assert.equal((await state(left.a)).ended_by_you, true);
      const peer = await state(left.b);
      assert.equal(peer.end_reason, "left");
      assert.equal(peer.ended_by_you, false);
    },
  );
  await check(
    "Already accepted connections remain accessible after feedback completes",
    async () => {
      await as(p.a);
      await db.query("select public.end_random($1)", [p.sid]);
      await db.query(
        "select public.submit_random_feedback($1,5,'good',false)",
        [p.sid],
      );
      await as(p.b);
      assert.equal(
        (await value("select public.random_state() v")).connection
          .conversation_id,
        cid,
      );
      assert.ok(
        (await value("select public.list_conversations() v")).some(
          (c) => c.id === cid,
        ),
      );
    },
  );
  await check(
    "Unauthenticated and unverified accounts cannot heartbeat, connect, or submit feedback",
    async () => {
      for (const who of [null, "00000000-0000-4000-8000-000000000099"]) {
        await as(who);
        await assert.rejects(() =>
          db.query("select public.random_heartbeat()"),
        );
        await assert.rejects(() =>
          db.query("select public.connect_random($1,'accepted')", [left.sid]),
        );
        await assert.rejects(() =>
          db.query("select public.submit_random_feedback($1,5,'good',false)", [
            left.sid,
          ]),
        );
      }
    },
  );
}
