import { describe, expect, it } from "vitest";
import { DEVICE_TABLE, findConnection } from "./device-table.js";

describe("findConnection", () => {
  it.each([
    { productId: 0x00b6, link: "wired" },
    { productId: 0x00b7, link: "wireless" },
    { productId: 0x00c2, link: "wired" },
    { productId: 0x00c3, link: "wireless" },
  ] as const)("maps 0x$productId to the DeathAdder V3 Pro, $link", ({ productId, link }) => {
    expect(findConnection(productId)).toEqual({
      model: expect.objectContaining({ name: "DeathAdder V3 Pro", rechargeable: true }),
      link,
      transactionId: 0x1f,
    });
  });

  it("uses each connection's own transaction ID", () => {
    expect(findConnection(0x025a)).toMatchObject({
      model: { name: "BlackWidow V3 Pro" },
      link: "wired",
      transactionId: 0x3f,
    });
    expect(findConnection(0x025c)).toMatchObject({
      model: { name: "BlackWidow V3 Pro" },
      link: "wireless",
      transactionId: 0x9f,
    });
  });

  it("knows older models that use transaction ID 0xFF", () => {
    expect(findConnection(0x007b)).toMatchObject({
      model: { name: "Viper Ultimate" },
      link: "wireless",
      transactionId: 0xff,
    });
  });

  it("marks models on disposable batteries as not rechargeable", () => {
    expect(findConnection(0x0083)?.model).toMatchObject({
      name: "Basilisk X HyperSpeed",
      rechargeable: false,
    });
  });

  it("does not know other Razer products", () => {
    expect(findConnection(0x1234)).toBeUndefined();
  });
});

describe("DEVICE_TABLE", () => {
  it("lists each product ID once", () => {
    const productIds = DEVICE_TABLE.flatMap((m) => m.connections.map((c) => c.productId));

    expect(new Set(productIds).size).toBe(productIds.length);
  });

  it("names each model once", () => {
    const names = DEVICE_TABLE.map((m) => m.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
