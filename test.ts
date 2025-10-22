/**
 * test.ts
 *
 * TypeScript version of the original test.js.
 * - Reads a compiled sproto bundle (protocol.spb)
 * - Creates sproto instance and demonstrates host/attach/dispatch usage
 *
 * Notes:
 * - We use Uint8Array directly from Node Buffer for better performance.
 * - This file is intended to be executed directly with Bun (recommended) or with Node after compiling.
 */

import fs from "fs";
import sproto from "./src/sproto";

const filename = "./protocol.spb";

try {
  const raw = fs.readFileSync(filename);
  if (!raw || raw.length === 0) {
    console.error("read file error:", filename);
    process.exit(1);
  }

  // convert Node Buffer -> Uint8Array
  const bundle: Uint8Array = new Uint8Array(raw);

  // create sproto instance from bundle
  const sp = sproto.createNew(bundle);
  if (!sp) {
    console.error("sproto.createNew returned null. Is the bundle valid?");
    process.exit(2);
  }

  console.log("sproto instance created.");

  // create a host for package "base.package"
  const client = sp.host("base.package");

  // create an attach (request) function bound to this sp
  const clientRequest = client.attach(sp);

  const data = {
    token: "testtestxxxxxxxxxxxxxxxxxxxxxxxxxxttttttttttttttttttttttttttttttttttesttestxxxxxxxxxxxxxxxxxxxxxxxxxxttttttttttttttttttttttttttttttttt",
    ctx: {
      proto_checksum: "xxxxx",
    },
  };

  // build request buffer (packed)
  const req = clientRequest("login.login", data);
  console.log("packed request (byte length):", req ? req.length : req);

  // dispatch the packed request to the host (simulate receive)
  const ret = client.dispatch(req);
  console.log("dispatch return:", ret);
} catch (err) {
  console.error("error:", err);
  process.exit(99);
}
