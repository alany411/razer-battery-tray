// The device table: Razer wireless models whose battery OpenRazer reads (razermouse_driver.c and
// razerkbd_driver.c), with the product IDs and transaction IDs it uses for them.

export type Link = "wired" | "wireless";

export interface Connection {
  productId: number;
  /** `wireless` covers the dongle (on older models, the charging dock that relays like one) and Bluetooth. */
  link: Link;
  transactionId: number;
}

export interface DeviceModel {
  name: string;
  /** False for models on disposable batteries, which have no charging flag. */
  rechargeable: boolean;
  connections: readonly Connection[];
}

function mouse(
  name: string,
  transactionId: number,
  { wired = [], wireless = [] }: { wired?: number[]; wireless?: number[] },
  { rechargeable = true } = {},
): DeviceModel {
  return {
    name,
    rechargeable,
    connections: [
      ...wired.map((productId) => ({ productId, link: "wired" as const, transactionId })),
      ...wireless.map((productId) => ({ productId, link: "wireless" as const, transactionId })),
    ],
  };
}

/** A keyboard whose wired and wireless connections use different transaction IDs. */
function keyboard(
  name: string,
  wired: { productId: number; transactionId: number },
  wireless?: { productId: number; transactionId: number },
): DeviceModel {
  return {
    name,
    rechargeable: true,
    connections: [
      { ...wired, link: "wired" },
      ...(wireless ? [{ ...wireless, link: "wireless" as const }] : []),
    ],
  };
}

const AA = { rechargeable: false };

export const DEVICE_TABLE: readonly DeviceModel[] = [
  // Mice
  mouse("DeathAdder V3 Pro", 0x1f, { wired: [0x00b6, 0x00c2], wireless: [0x00b7, 0x00c3] }),
  mouse("DeathAdder V3 HyperSpeed", 0x1f, { wired: [0x00c4], wireless: [0x00c5] }),
  mouse("DeathAdder V4 Pro", 0x1f, { wired: [0x00be], wireless: [0x00bf] }),
  mouse("DeathAdder V2 Pro", 0x3f, { wired: [0x007c], wireless: [0x007d] }),
  mouse("DeathAdder V2 X HyperSpeed", 0x1f, { wireless: [0x009c] }, AA),
  mouse("Mouse on HyperPolling dongle", 0x1f, { wireless: [0x00b3] }),
  mouse("Viper V3 Pro", 0x1f, { wired: [0x00c0], wireless: [0x00c1] }),
  mouse("Viper V3 Pro SE", 0x1f, { wired: [0x00de], wireless: [0x00df] }),
  mouse("Viper V3 HyperSpeed", 0x1f, { wireless: [0x00b8] }, AA),
  mouse("Viper V2 Pro", 0x1f, { wired: [0x00a5], wireless: [0x00a6] }),
  mouse("Viper Mini SE", 0x1f, { wired: [0x009e], wireless: [0x009f] }),
  mouse("Viper Ultimate", 0xff, { wired: [0x007a], wireless: [0x007b] }),
  mouse("Basilisk V3 Pro", 0x1f, { wired: [0x00aa], wireless: [0x00ab] }),
  mouse("Basilisk V3 Pro 35K", 0x1f, { wired: [0x00cc], wireless: [0x00cd] }),
  mouse("Basilisk V3 Pro 35K Phantom Green Edition", 0x1f, {
    wired: [0x00d6],
    wireless: [0x00d7],
  }),
  mouse("Basilisk V3 X HyperSpeed", 0x1f, { wireless: [0x00b9] }, AA),
  mouse("Basilisk X HyperSpeed", 0xff, { wireless: [0x0083] }, AA),
  mouse("Basilisk Ultimate", 0x1f, { wired: [0x0086], wireless: [0x0088] }),
  mouse("Basilisk Mobile", 0x1f, { wired: [0x00d3], wireless: [0x00d4] }, AA),
  mouse("Cobra Pro", 0x1f, { wired: [0x00af], wireless: [0x00b0] }),
  mouse("Cobra HyperSpeed", 0x1f, { wired: [0x00da], wireless: [0x00db] }),
  mouse("Naga V2 Pro", 0x1f, { wired: [0x00a7], wireless: [0x00a8] }),
  mouse("Naga V2 HyperSpeed", 0x1f, { wireless: [0x00b4] }, AA),
  mouse("Naga Pro", 0x1f, { wired: [0x008f], wireless: [0x0090] }),
  mouse("Naga Epic Chroma", 0xff, { wired: [0x003e], wireless: [0x003f] }),
  mouse("Naga Epic", 0xff, { wireless: [0x001f] }),
  mouse("Pro Click", 0x1f, { wired: [0x0080], wireless: [0x0077] }),
  mouse("Pro Click Mini", 0x1f, { wireless: [0x009a] }),
  mouse("Pro Click V2", 0x1f, { wired: [0x00d0], wireless: [0x00d1] }),
  mouse("Pro Click V2 Vertical Edition", 0x1f, { wired: [0x00c7], wireless: [0x00c8] }),
  mouse("Orochi V2", 0x1f, { wireless: [0x0094, 0x0095] }, AA),
  mouse("Atheris", 0x1f, { wireless: [0x0062] }, AA),
  mouse("Lancehead", 0x3f, { wired: [0x0059], wireless: [0x005a] }),
  mouse("Lancehead Wireless", 0x1f, { wired: [0x0070], wireless: [0x006f] }),
  mouse("Mamba Wireless", 0x3f, { wired: [0x0073], wireless: [0x0072] }),
  mouse("Mamba", 0xff, { wired: [0x0044], wireless: [0x0045] }),
  mouse("Mamba (2012)", 0xff, { wired: [0x0024], wireless: [0x0025] }),
  mouse("Ouroboros", 0xff, { wireless: [0x0032] }),
  // Keyboards
  keyboard(
    "BlackWidow V3 Pro",
    { productId: 0x025a, transactionId: 0x3f },
    { productId: 0x025c, transactionId: 0x9f },
  ),
  keyboard(
    "BlackWidow V3 Mini HyperSpeed",
    { productId: 0x0258, transactionId: 0x1f },
    { productId: 0x0271, transactionId: 0x9f },
  ),
  keyboard(
    "BlackWidow V4 Mini HyperSpeed",
    { productId: 0x02b9, transactionId: 0x1f },
    { productId: 0x02ba, transactionId: 0x9f },
  ),
  keyboard(
    "BlackWidow V4 Tenkeyless HyperSpeed",
    { productId: 0x02d7, transactionId: 0x1f },
    { productId: 0x02d5, transactionId: 0x9f },
  ),
  keyboard(
    "DeathStalker V2 Pro",
    { productId: 0x0292, transactionId: 0x1f },
    { productId: 0x0290, transactionId: 0x9f },
  ),
  keyboard(
    "DeathStalker V2 Pro TKL",
    { productId: 0x0298, transactionId: 0x1f },
    { productId: 0x0296, transactionId: 0x9f },
  ),
  // Bluetooth only otherwise, so the battery is read through the cable.
  keyboard("Joro", { productId: 0x02cd, transactionId: 0x1f }),
];

const byProductId = new Map(
  DEVICE_TABLE.flatMap((model) =>
    model.connections.map((connection) => [connection.productId, { model, ...connection }]),
  ),
);

/** The model and connection behind a Razer product ID, or undefined if it is not in the table. */
export function findConnection(
  productId: number,
): { model: DeviceModel; link: Link; transactionId: number } | undefined {
  const found = byProductId.get(productId);
  return found && { model: found.model, link: found.link, transactionId: found.transactionId };
}
