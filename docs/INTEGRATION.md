# 重構整合說明

## 新的資料夾結構

```
scripts/
├── core/                  ← 新增（純資料/工具，不掛在任何節點上）
│   ├── GameConstants.ts   所有魔術數字與分組字串
│   ├── PartType.ts        PartType / WeaponMode 列舉統一處
│   └── PartUtils.ts       cleanName / isCoreNode / getPrefabByName 等共用函式
│
├── battle/                ← 新增（戰鬥用純邏輯，不掛在任何節點上）
│   ├── JointFactory.ts    焊接 / 輪子 / 武器關節的建立
│   ├── WeaponSystem.ts    子彈發射（玩家與 Bot 共用）
│   ├── CarBuilder.ts      依網格生成整台車、掛血量、接關節
│   └── BotAI.ts           敵方移動 / 近戰 / 射擊
│
├── BattleManager.ts       ← 改寫：從 ~760 行瘦身成「協調者」，只保留 @property 與流程
├── HealthManager.ts       ← 改寫：用 PartUtils + DAMAGE 常數（行為不變）
├── Bullet.ts              ← 改寫：移除未使用的 Health import，打破循環依賴
├── Draggable.ts           ← 改寫：WeaponMode 改由 core 匯入並 re-export
├── Slotsetting.ts         ← 改寫：PartType 改由 core 匯入並 re-export
├── ShopManager.ts         ← 改寫：重複工具函式改為委派 PartUtils
│
├── GameManager.ts         ← 未更動
├── MenuManager.ts         ← 未更動
└── SettingManager.ts      ← 未更動
```

## ⚠ 整合時最重要的一件事（Cocos meta / uuid）

Cocos 用每個腳本旁邊的 `.ts.meta` 裡的 **uuid** 來認得「節點上掛的是哪支腳本」。
所以：

- **六個「改寫」的組件檔，請用「覆蓋內容」的方式取代原檔，不要刪掉重建、也不要改檔名。**
  保留原本的 `.ts` 與 `.ts.meta`，只把 `.ts` 的內容換成新版，編輯器上的拖拉綁定才不會掉。
- **不要在檔案總管（Finder / 檔案總管）裡搬移或改名這些組件檔。**
  若真的要移動組件檔的位置，請「在 Cocos 編輯器裡」拖移，編輯器會幫你同步 uuid。
- `core/` 與 `battle/` 裡的檔案都是**新增的純邏輯類別**，沒有掛在任何節點上，
  直接把這兩個資料夾放進 `scripts/` 底下即可，不會有 uuid 問題。

## import 路徑前提

所有改寫過的組件都假設它們位於 `scripts/` 根目錄，而 `core/` 與 `battle/` 是其下的子資料夾。
若你的腳本實際放在別處（例如 `assets/scripts/`），只要維持「組件在上層、core/battle 在其下一層」的相對關係即可，相對路徑不需更動。

## 保留下來的相容設計

- `Slotsetting.ts` 仍 `export { PartType }`，`Draggable.ts` 仍 `export { WeaponMode }`，
  所以任何舊的 `import { PartType } from "./Slotsetting"` / `import { WeaponMode } from "./Draggable"` 都還能用。
- `PartType` 的列舉數值（Body=0, Weapon=1, Core=4, Wheel=5）**完全沒動**，
  編輯器裡既有的下拉選擇（以整數儲存）不會跑掉。

## 行為對照

這次是「結構重構」，不是「行為調整」。倒數、移動、近戰、射擊、碰撞傷害公式、
驟死掉零件與核心扣血、勝負與金幣、場景切換，數值與流程都與原版一致；
只是把它們搬到各自負責的模組裡。

唯一順手清掉的小東西：原本 `spawnGridCar` 裡有一行重複的 `setPosition`（前一行的結果會被後一行覆蓋），
新版只保留有效的那一次，最終位置相同。
