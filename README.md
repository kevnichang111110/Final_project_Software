# Car Battle — 自組戰車對戰

一款用 **Cocos Creator 2.4.8** 製作的 2D 物理戰車對戰遊戲。玩家在商店用「網格零件」拼出自己的戰車（車身、輪子、武器、特殊方塊），再進入競技場用 Box2D 物理引擎一決勝負。支援單機（對電腦 / 本機雙人）與**線上即時對戰**。

---

## 玩法概觀

1. **選模式**：對電腦（Vs Bot）或本機雙人。
2. **商店組車**：把零件拖放到網格上拼出戰車，核心被打爆就輸。
3. **戰鬥**：進競技場對戰，有倒數、計時、驟死（Sudden Death）機制。
4. **搶奪階段**：非最終勝局結束後，場上灑出道具箱，兩方競速搶零件（像《超級雞馬》的隨機箱）。
5. **結算**：勝負統計，回到商店繼續強化或進入下一局。

### 操作

| 按鍵 | 動作 |
| --- | --- |
| `A` / `←` | 地面左移；空中向左旋轉車身 |
| `D` / `→` | 地面右移；空中向右旋轉車身 |
| `Space` | 近戰揮砍 / 一般槍開火 |
| `W` / `↑` | 噴射 boost（噴射輪） |
| 按住滑鼠左鍵 | 朝游標方向發射滑鼠瞄準砲（無差別傷害） |

---

## 主要特色

- **網格組車系統**：零件依網格相鄰關係自動焊接（body 互焊、輪子接 WheelJoint、武器接砲塔/焊死關節），核心被摧毀即敗。
- **物理戰鬥**：碰撞、近戰相對速度判傷、子彈、爬牆（WallRide）、空中姿態控制（AirPhysics）、卡住自救（StuckRescue）。
- **武器**：一般槍、近戰、**滑鼠瞄準砲塔**（跟隨游標旋轉並射擊）。
- **特殊零件**：噴射 / 彈跳輪（WheelAbility）、高防禦 / 回血方塊（BlockTrait）。
- **打擊回饋**：鏡頭震動、頓格（hitstop）、火花、槍口火光等。
- **線上對戰**：主機權威（host-authoritative）架構，P1 跑物理模擬、P2 渲染主機快照；血條、子彈、特效、滑鼠槍皆同步。
- **帳號 / 排行榜**：Firebase 驗證、玩家資料、排行榜。

---

## 技術架構

- **引擎**：Cocos Creator `2.4.8`（JS engine，TypeScript 腳本），橫向，設計解析度 `960 × 640`。
- **物理**：內建 Box2D（`cc.PhysicsManager`）。
- **連線**：[Colyseus](https://colyseus.io/) 客戶端（`colyseus.js`），對接外部 Render 伺服器。
- **後端服務**：Firebase（Auth / Firestore / 排行榜）。
- **啟動場景**：`Menu`。

### 專案結構

```
assets/
├── Scene/                    場景（Menu / SelectMode / Shop / onlineShop / game / Scramble / Result / Opening …）
├── Scripts/
│   ├── core/                 純資料 / 工具：GameConstants、PartType、PartUtils、NodePool、PartAudio
│   ├── battle/               戰鬥邏輯：BattleManager 委派的 CarBuilder、CarCtrl、WeaponSystem、BotAI、
│   │                         JointFactory、WallRide、AirPhysics、StuckRescue、Explosion、BattleNetSync
│   ├── abilities/            WheelAbility（噴射/彈跳）、BlockTrait（防禦/回血）
│   ├── weapons/              MouseCannon（滑鼠瞄準砲）
│   ├── map/                  MapLoader、地圖 / 軌道生成、Seesaw（翹翹板）、SpringPad
│   ├── scramble/             搶奪階段：ScrambleManager / ScrambleGrabber / ScrambleBox
│   ├── fx/                   視覺特效：HitFeedback、HitSpark、MuzzleFlash、WheelDust、HealGlow
│   ├── online/              線上對戰：OnlineClient（連線）、OnlineRuntime（狀態）、OnlineShopReadyManager
│   ├── net/                  Firebase：AuthManager、ProfileManager、LeaderboardManager、FirebaseService
│   ├── BattleManager.ts      戰鬥場景協調者（依模式 LOCAL / HOST / CLIENT 分流）
│   ├── ShopManager.ts        商店組車
│   ├── GameManager.ts        跨場景全域狀態（比分、模式、車輛網格資料）
│   ├── MenuManager.ts / ResultManager.ts / SettingManager.ts …
│   └── HealthManager.ts      血量 / 血條
├── prefab/                   零件與物件 prefab
├── Pictures/ Audio/ font/ Animation/   美術 / 音效 / 字型 / 動畫資源
docs/                         功能整合與編輯器設定說明
```

### 線上對戰架構（重點）

採 **主機權威（host-authoritative）**：

- 房間第一位是 **P1（HOST）**、第二位是 **P2（CLIENT）**。
- **HOST** 跑完整物理，兩台真人車各用一個 `CarCtrl`（己方吃鍵盤/滑鼠、對手吃網路輸入），每幀把世界快照（車輛零件位置/角度/血量、子彈、掉落物、翹翹板、特效）廣播出去。
- **CLIENT** 關閉物理，只送出自己的輸入並渲染主機快照。
- 兩端共用同一套 `BattleManager` / `ShopManager`，靠 `OnlineRuntime` 在 `onLoad` 決定模式，不再有獨立的線上管理器。

> **跨 repo 重要約束**：Colyseus 伺服器（部署在 Render）必須手動把 `input`、`sync` 等訊息轉發給對手（`broadcast(..., {except: client})`），並確保 `onJoin` 給兩台不同 seat，否則 P2 收不到快照或出現「雙主機」。

---

## 開發 / 執行

### 需求

- [Cocos Creator **2.4.8**](https://www.cocos.com/creator)（請用相符版本開啟，避免 meta/uuid 不相容）。
- 線上對戰另需可連線的 Colyseus 伺服器（預設指向 `car-server-rle9.onrender.com`，於 `OnlineClient.ts` 設定）。

### 在編輯器中開啟

1. 用 Cocos Creator 2.4.8 開啟本專案資料夾。
2. 等待編輯器匯入資源（`library/`、`temp/` 會自動產生，已被 `.gitignore` 忽略）。
3. 開啟 `assets/Scene/Menu.fire`，按編輯器的 **預覽** 即可在瀏覽器試玩。

### 建置

於 Cocos Creator 的 **專案 → 建置發布** 選擇平台（Web / Android / iOS / Mac 等）後建置。

---

## 文件

`docs/` 內有各功能在編輯器中的設定步驟：

- `INTEGRATION.md` — 腳本重構與資料夾結構說明。
- `FEATURES_BATCH1.md` — 記分板、滑鼠砲、空中旋轉、噴射輪、防禦/回血方塊等功能與編輯器設定。
- `MAP_EDIT.md` — 環形地圖與翹翹板的搭建方式。
- `SCRAMBLE_PHASE.md` — 搶奪階段的整合與設定。

---

## 注意事項

- `library/`、`temp/`、`build/`、`local/` 為 Cocos 產生物，不納入版控。
- 修改腳本後，編輯器會自動重新編譯；若 prefab / 場景綁定異常，多半是 meta/uuid 不一致，請確認用對應版本開啟。
</content>
</invoke>
