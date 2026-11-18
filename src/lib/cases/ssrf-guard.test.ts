/** Test af SSRF-adresseregler (ip-guard). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress } from "./ip-guard.ts";

test("private og ikke-offentlige adresser afvises", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.254",
    "198.18.0.1",
    "198.19.255.255",
    "192.0.0.8",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "::ffff:100.64.0.1",
    "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

test("offentlige adresser tillades", () => {
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255",
    "100.128.0.1",
    "198.17.0.1",
    "198.20.0.1",
    "192.0.2.1",
    "172.32.0.1",
    "2606:4700::1111",
    "::ffff:8.8.8.8",
  ]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});
