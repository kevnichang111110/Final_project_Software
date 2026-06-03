# 搶奪階段（第 9 點）整合說明

## 這是什麼
每局戰鬥結束後（非最終勝局）會進入一個即時競速的「搶奪階段」：場上散佈 4~5 個道具箱，
兩位競爭者各自跑動，**身體先碰到箱子的人就搶走該道具**（像超級雞馬的隨機箱子）。結束後進商店。

兩種模式都支援（由 `GameManager.gameMode` 決定）：
- `VsBot`（預設）：P1 是你、對手是會自動追箱子的 BOT。
- `LocalTwoPlayer`：P1 + P2 兩位本機玩家。

## 新增檔案
```
scripts/scramble/
├── ScrambleManager.ts   場景總控（生成場地/角色/箱子、計時、結算）
├── ScrambleGrabber.ts   競爭者（移動 + 跳）
└── ScrambleBox.ts       道具箱（被碰到就被搶）
```

## 編輯器要做的事
1. 新建一個場景，命名為 **`Scramble`**（要和 `GameConstants.FLOW.SCRAMBLE_SCENE` 一致）。
2. 場景裡放一個節點（例如掛在 Canvas 下的空節點），掛上 **`ScrambleManager`** 組件。
3. 在 `ScrambleManager` 的 **`toolPool`** 填入「可被搶的道具名稱」——這些名稱要對得上戰鬥場景
   `BattleManager.allPrefabs` 裡的 prefab 名稱（例如 `Wheel2`、`Gun1`、`Body1`），這樣玩家搶到後
   商店才認得、能免費發給你。
4. （選用）把 `startSfx / claimSfx / endSfx` 拖進去。
5. 場地、角色、箱子都是程式用 Graphics + 物理碰撞器生成的，**沒有美術也能直接跑**；之後想換成
   自己的 prefab，改 `ScrambleManager.makeRect` 那段即可。

> 還沒準備好 Scramble 場景前，可把 `GameConstants.FLOW.USE_SCRAMBLE` 設成 `false`，
> 回合結束就會像以前一樣直接進商店，不會因為找不到場景而報錯。

## 流程
戰鬥結束 →（非最終勝局）Scramble →（搶完或時間到）Shop。
最終勝局（有人達 4 勝）仍然是直接回 Menu，不進搶奪。

## 控制
- P1：A/D 移動、W 跳
- P2（雙人模式）：← / → 移動、↑ 跳
- BOT（vs 電腦）：自動追最近的未搶箱子，箱子在高處會自己跳

## 搶到的道具怎麼用
- 結束時把各側搶到的道具名稱寫進 `GameManager.claimedTools`（P1 / P2 / BOT）。
- **玩家(P1)**：進商店時會自動把搶到的道具免費生成在上方，讓你拖進組裝格（已接好，見 ShopManager.grantClaimedTools）。

## 目前的限制 / 後續可決定的點
- 模式切換：`GameManager.gameMode` 預設 `VsBot`。要玩雙人，請在 Menu 加一個按鈕設成
  `GameManager.gameMode = GameMode.LocalTwoPlayer`（我沒動 MenuManager，避免影響你既有的選單綁定）。
- **BOT / P2 搶到的道具目前只有「記錄」**，還沒接進它們的車子（Bot 用固定 botConfigs，P2 的完整雙人戰鬥也尚未建立）。
  要讓對手也因搶到道具而變強，需要決定「道具如何進入對手的車」，這個我們可以下一輪再做。
- 物理分組用 `"default"`（會互相碰撞），所以不需要動你的碰撞矩陣設定。
- 搶奪場景的重力、地面、平台都是寫死的預設值，手感/版面要調就改 `GameConstants.SCRAMBLE`。
