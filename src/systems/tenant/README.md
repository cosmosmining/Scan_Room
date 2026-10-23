# systems/tenant/ — Multi-Tenant Platform + Layered Customization

The machine-readable form of the partnership architecture — and the answer to
Ken's concern, *"other competitors will use these apps as well, correct?"*

Yes, the **core**; never Mozu's **branded experience**.

## Three layers

| Layer | Owner | Features | Shared? |
| --- | --- | --- | --- |
| **1 · Core** | RoomMuse | room scanning · AR visualization · data storage · tenant isolation | shared by all brands (data still isolated) |
| **2 · White-label** | configurable | product catalog · 2D editor · booking & pricing · style cards | licensable to other brands (build your own logic) |
| **3 · Brand** | the operating tenant | AI layout · curated themes · workflow · branded UI | **exclusive — invisible to other tenants** |

Every brand runs on Layers 1–2; only the operating tenant owns its Layer 3. A
competitor in another category (sofas) gets the same core tech but must design its
own workflow and cannot see or replicate Mozu's.

## API

```ts
resolveTenant(id)                      // → TenantConfig (defaults to Mozu)
layerOf(tenant, feature)               // 'core' | 'white-label' | 'brand'
isExclusive(tenant, feature)           // owned at the brand layer?
exclusiveFeatures(tenant)              // the private Layer-3 stack
isSharedAcrossBrands(feature)          // licensable to any brand?
accessibleFeatures(owner, viewer)      // what `viewer` sees of `owner`'s features
brandTokens(tenant)                    // the UI skin
```

`accessibleFeatures(MOZU, competitor)` returns the shared core + white-label tiers
but **not** `ai-layout` / `curated-themes` / `workflow` — the contract that keeps
Mozu's experience private for its exclusivity window (24 months). See
`__tests__/tenant.test.ts`.

## Tenants

`MOZU_TENANT` (launch brand, full Layer-3, kitchen + wardrobe → sofas/beds within
its branded space), `ROOMMUSE_CORE` (bare Layers 1–2), `SAMPLE_COMPETITOR`
(another category on the same core — proves the isolation).
