# 新功能整合說明（第 1~8 點）

## 新增檔案放哪
把這兩個新資料夾放到 `scripts/` 底下（和 `core/`、`battle/` 同層）：

```
scripts/
├── core/PartAudio.ts          ← 新增（通用音效介面，第 8 點）
├── abilities/
│   ├── WheelAbility.ts        ← 新增（噴射/彈跳輪，第 4 點）
│   └── BlockTrait.ts          ← 新增（高防禦/回血方塊，第 6 點）
└── weapons/MouseCannon.ts     ← 新增（滑鼠瞄準砲，第 2、7 點）
```

改寫過、要覆蓋原檔的：`BattleManager.ts`、`HealthManager.ts`、`Bullet.ts`、`ShopManager.ts`、`battle/WeaponSystem.ts`、`battle/CarBuilder.ts`、`core/GameConstants.ts`（這個是「附加」內容到檔尾）。

---

## 操作 / 控制
- A / ← ：左移（地面）＋ 空中向左旋轉
- D / → ：右移（地面）＋ 空中向右旋轉
- 空白鍵：近戰揮砍 / 一般槍開火（原本就有）
- W / ↑ ：噴射 boost（觸發噴射輪）
- 按住滑鼠左鍵：朝游標方向發射滑鼠砲（無差別傷害）

---

## 各功能在編輯器要做的事

### 1. 記分板（第 1 點）
不用做任何事。進入戰鬥場景後左上（PLAYER）、右上（BOT）會自動出現分數，分數來自 GameManager。

### 2. 滑鼠瞄準砲（第 2、7 點）
- 做一個武器 prefab，掛上 `MouseCannon` 組件。
- 在這個 prefab 底下加一個名為 **`firepoint`** 的子節點，放在砲口尖端（子彈從這裡射出；沒有的話會自動往前 45px，可能會擦到自己）。
- 子彈沿用 BattleManager 上綁的 `bulletPrefab`（要有 RigidBody + Bullet + Collider）。
- 它的子彈是「無差別」的：打到自己或對方的方塊都會扣血，這是你要的效果，所以放置砲口時盡量讓它朝外。
- 速度/傷害/間隔可在 `MouseCannon` 組件上各自調。

### 3. 商店三分類（第 3 點）
- 商店的 3 個格子現在固定是「方塊 / 武器 / 輪子」。
- 到 ShopManager 的 `itemPool`，把每個商品的 **`category`** 設成 方塊(Body) / 武器(Weapon) / 輪子(Wheel)。
- 需要剛好 3 個格子（你目前就是 3 個）；某類別暫時沒有可解鎖商品時，該格會退而抽其他商品避免空格。

### 4. 特殊輪子（第 4 點）
- 在輪子 prefab 掛 `WheelAbility`，選 `type`：
  - `Jet` 噴射：按 W/↑ 時持續向上噴（`jetForce` 可調）。
  - `Bounce` 彈跳：自動把碰撞器反彈係數調高（`bounceRestitution`），落地會彈；**這顆輪子要有 PhysicsCollider 才有效**。
- 想加新能力（衝刺、磁吸…）就在 `WheelAbilityType` enum 加一項，再到觸發點處理。

### 5. 空中旋轉（第 5 點）
- 不用做設定。A/D 會對「核心」施加扭矩。
- 地面上輪子和焊接會抵消大部分扭矩，主要在離地時生效，可用來翻正車身。
- 手感用 `GameConstants.AIR.ROTATE_TORQUE`（扭矩）與 `MAX_ANGULAR_SPEED`（轉速上限）調。若在地面感覺會被帶著轉，把扭矩調小。

### 6. 特殊方塊（第 6 點）
- 在方塊 prefab 掛 `BlockTrait`：
  - `damageMultiplier`：受傷倍率，`0.5` = 只受一半傷（高防禦）。
  - `regenPerSecond`：每秒自動回血，`0` = 不回。
- 高防禦方塊也建議把 `Health.maxHP` 一起調高，血厚又抗打。

### 7. 特殊武器（第 7 點）
- 滑鼠砲就是一種特殊武器（見第 2 點）。
- 要再做別種特殊武器，建議比照 `MouseCannon` 的模式：做一個小組件掛在武器 prefab 上、提供參數，由 BattleManager 或對應系統在適當時機呼叫 `WeaponSystem`。

### 8. 音效介面（第 8 點）
- 在任何零件 prefab 掛 `PartAudio`，把各情境音效拖進去：spawn / hit / die / attack / ability。
- 已自動接上的呼叫點：
  - 受擊、被摧毀 → Health 會呼叫 `playHit()` / `playDie()`（沒掛 PartAudio 時退回 Health 舊的 hitSound/dieSound）。
  - 噴射 → WheelAbility 呼叫 `playAbility()`。
  - 滑鼠砲開火 → BattleManager 呼叫 `playAttack()`。
  - 生成 → CarBuilder 呼叫 `playSpawn()`。
- 其他想發聲的地方，直接 `node.getComponent("PartAudio")?.playXXX()` 即可。

---

## 可調參數（core/GameConstants.ts 檔尾）
- `AIR`：空中旋轉扭矩、轉速上限
- `ABILITY`：噴射推力、彈跳係數
- `MOUSE_BULLET`：滑鼠砲子彈速度 / 傷害 / 存活 / 間隔

---

## 小提醒
- 我沒有測試環境，請一個功能一個功能開來確認（建議順序：記分板 → 商店分類 → 音效 → 滑鼠砲 → 噴射/彈跳 → 空中旋轉）。
- 滑鼠座標用 `cc.Camera.main` 轉成世界座標；若你的場景相機有縮放/位移，瞄準若有偏移再跟我說，我幫你校正換算。
