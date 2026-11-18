import { test } from "node:test";
import assert from "node:assert/strict";
import { saveDraftRpcArgs } from "./save-draft-args.ts";

const input = {
  configId: "00000000-0000-4000-8000-000000000001",
  fundName: "Testfond",
  strategyType: "venture" as const,
  thesis: "Tese",
  stages: ["Seed"],
  geographies: ["Danmark"],
  sectors: ["Software"],
  fundSizeEur: null,
  ticketMinEur: 500_000,
  ticketMaxEur: 2_000_000,
  ticketNote: "",
  analysisThreshold: 70,
  approvalMode: "partner_approval" as const,
  riskPosture: "Høj",
  stageExpectations: {},
  dealbreakers: [],
  gates: [],
  criteria: [],
};

test("the fund size is always sent with the set flag, also when it is cleared", () => {
  assert.equal(saveDraftRpcArgs(input)._set_fund_size, true);
  assert.equal(saveDraftRpcArgs(input)._fund_size_eur, null);
  const withSize = saveDraftRpcArgs({ ...input, fundSizeEur: 60_000_000 });
  assert.equal(withSize._fund_size_eur, 60_000_000);
  assert.equal(withSize._set_fund_size, true);
});

test("each criterion is sent with an explicit code anchor that matches the checkbox", () => {
  const args = saveDraftRpcArgs({
    ...input,
    criteria: [
      {
        key: "money",
        label: "Økonomi",
        description: "",
        category: "financial_strength",
        weight: 60,
      },
      {
        key: "reach",
        label: "Distribution",
        description: "",
        category: "financial_strength",
        weight: 40,
        codeAnchor: false,
      },
    ],
  });
  assert.deepEqual(
    args._criteria.map((criterion) => criterion.codeAnchor),
    [true, false],
  );
});
