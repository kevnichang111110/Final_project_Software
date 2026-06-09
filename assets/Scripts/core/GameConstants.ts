// core/GameConstants.ts
// 集中管理散落在各檔案的「魔術數字」與分組字串。
// 注意：已經是編輯器 @property 的欄位（例如 BattleManager 的 gunFireInterval、bulletSpeed）
// 仍留在組件上以保留可調性，這裡只收「寫死在程式碼裡」的常數。

export const GRID = {
    CELL_SIZE: 40,      // 每格 40px
    COUNT: 5,           // 5x5 網格
    AREA_MAX: 200,      // 組裝區範圍 0 ~ 200
    SNAP_OFFSET: 20,    // 吸附到格子中心的偏移
};

// 物理分組名稱（節點 group）。判斷陣營時是用 includes(PLAYER_KEY) 之類的關鍵字。
export const GROUP = {
    DEFAULT: "default",
    BOUNDARY: "boundary",
    PLAYER_PART: "PLAYER_PART",
    BOT_PART: "BOT_PART",
    PLAYER_BULLET: "PLAYER_BULLET",
    BOT_BULLET: "BOT_BULLET",
    PLAYER_KEY: "PLAYER",
    BOT_KEY: "BOT",
};

export const PHYSICS = {
    GRAVITY_Y: -960,
    VELOCITY_ITERATIONS: 40,
    POSITION_ITERATIONS: 40,
    FIXED_TIME_STEP: 1 / 60,
};

export const BATTLE = {
    MATCH_TIME: 20,             // 單局秒數
    COUNTDOWN_FROM: 2,          // 開場倒數起始值
    SUDDEN_DEATH_PARTS: 40,     // 驟死時掉落的零件數
    SUDDEN_DEATH_TICK: 0.25,    // 驟死扣血間隔
    PLAYER_CORE_DOT: 6,         // 驟死時玩家核心每跳扣血
    BOT_CORE_DOT: 5,            // 驟死時敵方核心每跳扣血
    BOT_HP_BONUS_PER_ROUND: 10, // 敵方每回合血量加成
    WIN_GOLD: 200,              // 每局結束發放金幣
    WINS_TO_FINISH: 4,          // 先贏幾場結束整場（七戰四勝）
};

export const JOINT = {
    WHEEL_FREQUENCY: 10,
    WHEEL_MAX_TORQUE: 400000,
    WHEEL_TARGET_SPEED: -1500,  // 玩家輪子目標馬達速度（乘上 moveDir）。與 BOT.MOVE_SPEED 同量級，否則玩家明顯比 bot 慢
    WHEEL_SMOOTHING: 0.2,       // 輪速插值平滑（調高一點讓起步更跟手）
    WELD_FREQUENCY: 0,
    MELEE_MAX_TORQUE: 10000,
    MELEE_ATTACK_SPEED: 1500,   // 玩家近戰揮出
    MELEE_RETURN_SPEED: -500,   // 玩家近戰收回
    // 近戰武器角度限制（依陣營）
    PLAYER_LOWER_ANGLE: -20,
    PLAYER_UPPER_ANGLE: 120,
    BOT_LOWER_ANGLE: -120,
    BOT_UPPER_ANGLE: 20,
};

export const BOT = {
    CHASE_DIST: 220,    // 距離大於此值就追
    RETREAT_DIST: 120,  // 距離小於此值就退
    ATTACK_RANGE: 300,  // 進入此距離才揮武器
    MOVE_SPEED: 1500,
    ATTACK_SPEED: 1000,
    RETURN_SPEED: -400,
};

export const DAMAGE = {
    COLLISION_THRESHOLD: 260,   // 相對速度低於此值不造成碰撞傷害（提高 → 更難造成碰撞傷害）
    COLLISION_DIVISOR: 16,      // (相對速度 - 門檻) / 此值 = 傷害（加大 → 傷害變低）
    WEAPON_VS_WEAPON: 0.2,      // 武器互撞折扣
    SELF_WEAPON_MULT: 0.05,     // 我是武器去撞人，我受的傷
    OTHER_WEAPON_MULT: 4.0,     // 別人用武器撞我，我受的傷
    BULLET_VS_WEAPON: 0.5,      // 子彈打到武器部件的折扣
    MAX_PER_HIT: 50,            // 單次最大傷害
    MIN_TO_APPLY: 0.5,          // 低於此值的傷害忽略
    INVINCIBILITY: 0.1,         // 受擊後無敵時間
};

// === 以下為新功能新增的常數 ===

// 空中左右旋轉（施加在核心剛體上的扭矩）
export const AIR = {
    ROTATE_TORQUE: 220000,    // 旋轉扭矩（再調低）
    MAX_ANGULAR_SPEED: 80,    // 角速度上限（度/秒），愈小轉得愈慢（再調低）
    GROUNDED_PROBE: 6,        // 著地探測長度（縮短 → 只有幾乎貼地才算著地 → 空中旋轉更容易觸發）
};

// 特殊輪子能力
export const ABILITY = {
    JET_FORCE: 2600000,       // 噴射輪：boost 時每幀向上推力
    BOUNCE_RESTITUTION: 1.1,  // 彈跳輪：碰撞反彈係數
};

// 滑鼠瞄準砲（會傷害雙方方塊的子彈）
export const MOUSE_BULLET = {
    SPEED: 2000,
    DAMAGE: 25,
    LIFETIME: 2.5,
    FIRE_INTERVAL: 0.18,
};

// 搶奪階段（第 9 點，即時競速拍箱子）
export const SCRAMBLE = {
    DURATION: 15,          // 限時秒數
    MIN_BOXES: 4,
    MAX_BOXES: 5,
    MOVE_SPEED: 420,       // grabber 水平速度
    JUMP_IMPULSE: 9000,    // 跳躍衝量
    GRABBER_SIZE: 60,
    BOX_SIZE: 70,
    GROUND_Y: -300,        // 地面高度（場景中心為原點）
    ARENA_WIDTH: 1200,
    BOT_JUMP_DY: 50,       // Bot 目標箱子高出這麼多就跳
    AFTER_SCENE: "Shop",   // 搶奪結束後前往的場景
};

// 回合流程
export const FLOW = {
    USE_SCRAMBLE: false,       // 設 false 可暫時關閉搶奪階段（還沒建好 Scramble 場景時）
    SCRAMBLE_SCENE: "Scramble",
    USE_WALLRIDE: true,       // 牆面行駛：開啟才爬得了牆（關閉時玩家碰到牆只會滑下來）
    USE_STUCK_RESCUE: true,   // 卡住自救：車子想動卻動不了一段時間後，自動瞬移到最近可站的位置
};

// 卡住自救（StuckRescue）
export const RESCUE = {
    STUCK_TIME: 1.6,      // 「想動卻沒前進」累積多久才觸發救援（秒）
    MIN_PROGRESS: 26,     // 一幀位移超過此值就算有在動，重置計時（px）
    SEARCH_STEP: 70,      // 往外找站位的環間距（會被車體大小放大）
    SEARCH_RINGS: 6,      // 往外搜尋幾圈
    SEARCH_SAMPLES: 12,   // 每圈取樣的角度數
    DOWN_PROBE: 700,      // 候選點往下找地面的射線長度
    UP_PROBE: 40,         // 候選點往上一點當射線起點（避免起點剛好埋在地裡）
    CLEARANCE: 24,        // 站定後離地面的額外淨空
    COOLDOWN: 1.2,        // 兩次救援之間的冷卻（秒），避免連續瞬移
    ENCLOSE_PROBE: 4000,  // 判斷「是否在封閉場內」時四方向射線長度（要大於整張圖）
};

// 近戰揮砍冷卻
export const MELEE = {
    COOLDOWN: 0.55,            // 兩次揮砍之間的冷卻秒數
    REACH_TOLERANCE: 3,        // 視為「揮到頂」的角度容差（度）
};

// 滑鼠瞄準砲（旋轉砲塔）
export const MOUSE_TURRET = {
    HALF_ARC: 85,              // 可旋轉半角（度）；總範圍 = 2×，預設 170 度（略小於 180）。想要正負 90 = 180 就填 90
    AIM_GAIN: 20,              // 瞄準 P 控制器增益：角度差 × 此值 = 馬達速度
    AIM_SPEED: 1200,           // 瞄準馬達最大速度（度/秒）
    TORQUE: 600000,            // 瞄準馬達扭矩（要夠大才推得動槍）
};

// 牆面行駛 / 繞圈（相對地面重力）—— 這些是手感調校的主要旋鈕
export const WALLRIDE = {
    PROBE: 90,            // 從核心往車底探測地面的射線長度（要 > 車子半高）
    STICK: 0.5,           // 額外貼附力（相對重力的比例），愈大愈黏牆
    // 介入門檻：依「地面相對水平的傾斜度」漸進啟動。tilt = (1 - 法線.y)/2：平地=0、牆=0.5、天花板=1
    // tilt 低於 ENGAGE_LO（約 18 度以內，含地面小顛簸）→ 完全不介入，交給一般物理 → 不會亂彈
    // tilt 高於 ENGAGE_HI（約 50 度以上）→ 完全啟動牆面行駛
    // tilt 低於 ENGAGE_LO（約 50 度以內，含地面顛簸）→ 完全不介入；高於 ENGAGE_HI（約 70 度以上）→ 完全啟動
    ENGAGE_LO: 0.18,
    ENGAGE_HI: 0.32,
    NORMAL_SMOOTH: 0.25,  // 地面法線平滑係數（愈小愈平滑，抗顛簸）
    ALIGN_GAIN: 22000,    // 對齊扭矩增益（車頂轉向地面法線的力道）
    ALIGN_DAMP: 12000,    // 對齊阻尼（抑制過衝抖動）
    ALIGN_MAX: 1500000,   // 對齊扭矩上限
    WALL_THRESHOLD: 0.4,  // 地面法線水平分量大於此值視為「在牆上」才允許脫離
    DETACH_IMPULSE: 7000, // 脫離時往牆外彈的衝量
    DETACH_SPIN: 1200,    // 脫離時的翻轉角衝量
    DETACH_TIME: 0.5,     // 脫離後多久內不重新吸附（讓它飛出去）
};

// 打擊感特效（HitFeedback：鏡頭震動 + 縮放衝擊 + 火花 + hitstop）
// 所有強度依「傷害量」比例縮放：輕擦小晃、重擊大震。手感調校的旋鈕都集中在這。
export const HITFX = {
    MIN_DAMAGE: 2,            // 低於此傷害完全不觸發任何回饋（避免持續小擦撞抖個不停）

    // 鏡頭震動（trauma 模型：受擊累加 trauma，每幀衰減，位移 = shake^2）
    SHAKE_PER_DAMAGE: 0.06,  // 每點傷害換算的 trauma 增量（0~1）
    SHAKE_MAX_TRAUMA: 0.9,   // 單次累加後 trauma 上限
    SHAKE_MAX_OFFSET: 24,    // trauma=1 時的最大位移（px）
    SHAKE_MAX_ANGLE: 2.5,    // trauma=1 時的最大旋轉（度）
    SHAKE_DECAY: 1.8,        // trauma 每秒衰減量
    SHAKE_FREQ: 28,          // 抖動頻率（越高越「銳」）

    // 鏡頭縮放衝擊（zoom punch）：重擊才明顯。zoomRatio 變大 = 拉近
    ZOOM_PER_DAMAGE: 0.004,  // 每點傷害換算的 zoom 增量
    ZOOM_MAX: 0.12,          // zoom 衝擊上限
    ZOOM_IN_TIME: 0.05,      // 拉近時間（快）
    ZOOM_OUT_TIME: 0.18,     // 回復時間（慢）

    // hitstop（短暫慢動作）：只有大擊／爆破
    HITSTOP_DAMAGE: 22,      // finalDmg 超過此值才觸發
    HITSTOP_SCALE: 0.08,     // 慢動作時的 timeScale
    HITSTOP_TIME: 0.06,      // 慢動作持續秒數（真實時間）

    // 撞擊火花（HitSpark）
    SPARK_MIN_DAMAGE: 4,     // 低於此傷害不噴火花

    // 受擊濾鏡（全螢幕紅色閃光 + 邊角暗角 vignette；模擬「受傷」的鏡頭染色）
    FLASH_MIN_DAMAGE: 6,     // 低於此傷害不染紅
    FLASH_PER_DAMAGE: 0.012, // 每點傷害換算的紅色不透明度
    FLASH_MAX_ALPHA: 0.45,   // 紅色染色不透明度上限（0~1）
    FLASH_IN_TIME: 0.04,     // 染紅時間（快）
    FLASH_OUT_TIME: 0.32,    // 退去時間（慢）
    FLASH_COLOR_R: 200,      // 染色 RGB（偏暗紅，避免過曝）
    FLASH_COLOR_G: 30,
    FLASH_COLOR_B: 30,
};