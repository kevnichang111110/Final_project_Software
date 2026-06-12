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
    // 建車時把零件碰撞體外擴這麼多 px，讓車外緣接近連續實心、凹口變淺，
    // 避免薄碰撞體（蹺蹺板長條、地圖邊界細線）插進輪子/方塊縫。方塊寬高各 +此值，輪子半徑 +此值/2。
    COLLIDER_INFLATE: 6,
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
    WHEEL_FREQUENCY: 20,        // 懸吊彈簧頻率（Hz）。調高＝懸吊更硬、輪子相對車身位移更小（跳躍時不易看起來「拆開」）。
                                // 注意 dt=1/60 下別超過 ~28Hz 以免不穩；搭配 JointFactory 的 dampingRatio=1 臨界阻尼不彈跳
    WHEEL_DAMPING: 1.0,         // 懸吊阻尼比（1=臨界阻尼，不來回彈）
    WHEEL_MAX_TORQUE: 700000,   // 馬達最大扭矩（馬力）。調高 → 爬坡/爬牆更有力（之前 400000 太低爬不動）
    WHEEL_FRICTION: 0.9,        // 輪子摩擦力（抓地力）。Box2D 預設 ~0.2 太滑，斜坡會打滑空轉；調高才爬得上去
    WHEEL_TARGET_SPEED: -1500,  // 玩家輪子目標馬達速度（乘上 moveDir）。與 BOT.MOVE_SPEED 同量級，否則玩家明顯比 bot 慢
    WHEEL_SMOOTHING: 0.2,       // 輪速插值平滑（調高一點讓起步更跟手）
    WELD_FREQUENCY: 0,
    STAR_WELD_TO_CORE: true,    // 每個 body 額外焊一條到核心（隱形星狀框），讓車體更硬、零件不被甩飛。出問題可關
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
    // 空中旋轉改由 AirPhysics 客製化積分器處理（見下方 AIRPHYS）。這裡只留接觸偵測用的探測距離。
    GROUNDED_PROBE: 6,        // 著地探測長度（縮短 → 只有幾乎貼地才算著地）
    CONTACT_PROBE: 6,         // 「完全無接觸才進入空中模式」的多方向接觸偵測邊距（px）。愈大愈容易判定為接觸中（→ 愈難進入空中接管）
};

// Debug：按 P 切換，畫出每個零件的碰撞邊界、接觸探測射線、質心，並用顏色標示空中物理是否接管。
// 綠=AirPhysics 接管中（kinematic，零件不會飄）、紅=交給 Box2D（一般物理）。
export const DEBUG = {
    SHOW_BOUNDS: false,       // 初始是否開啟（遊戲中按 P 可切換）
};

// 客製化空中物理（AirPhysics，只套用在玩家車）：完全騰空時接管，整車當剛體繞質心轉。
// 旋轉只由「離地當下的角速度」起始 + 阻尼 + 左右輸入；下落為自由落體。
export const AIRPHYS = {
    ROT_INPUT: 480,   // 按住 A/D 每秒對角速度增加的量（度/秒²）
    MAX_SPIN: 480,    // 角速度上限（度/秒）。也夾住「離地初始旋轉」避免被彈飛打出超高速一直翻
    SPIN_DAMP: 1.4,   // 角速度每秒衰減比例（越大越快停轉）。放手後越轉越慢、不會一直翻
    GRAVITY_Y: -600,  // 空中下落重力（比世界 -960 緩）。調這個改空中掉落快慢：負越大掉越快
};

// 自動翻正：接觸地面/物體（非牆面）且車身傾斜時，施加修正扭矩讓車子回到直立。
// 牆面行駛時交給 WALLRIDE 對齊，這裡不介入。
export const UPRIGHT = {
    ENABLED: false,        // 總開關
    GAIN: 4000,            // 翻正扭矩增益（傾角 × 此值）。愈大回正愈快、也愈容易過衝
    DAMP: 6000,            // 角速度阻尼（抑制過衝抖動），調高比較不會彈
    MAX_TORQUE: 250000,    // 翻正扭矩上限（調低避免硬翻把車彈起來）
    // 遲滯：傾角超過 TRIGGER_ANGLE（接近翻倒）才開始翻正，一路修正到 RELEASE_ANGLE 內才停。
    // 兩段門檻避免「只修到一半就停」也避免在地面小傾斜時一直介入造成亂彈。
    TRIGGER_ANGLE: 55,
    RELEASE_ANGLE: 8,
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
    WALL_THRESHOLD: 0.4,  // （已停用）舊版判斷在牆上才允許脫離
    // 重心模型下牆：車身越「貼向牆面法線」抓得越牢；重心太靠外（lean 太低）抓地力歸零 → 自然下落。
    // lean = 車頂方向 · 牆面外法線（1=完全貼牆、<GRIP_LEAN_MIN=重心太靠外）。空中左右轉即在調整這個朝向（重心）。
    GRIP_LEAN_MIN: 0.25,  // 抓地力歸零的 lean 門檻；越大越容易因重心外傾而掉下來
    SLIDE: 0.35,          // 保留多少「沿牆方向」的重力（0=完全黏死不滑、1=完全自然下滑）。不主動爬時會自然沿牆下滑
};

// 打擊感特效（HitFeedback：背景震動 + 火花 + hitstop）
// 所有強度依「傷害量」比例縮放：輕擦小晃、重擊大震。手感調校的旋鈕都集中在這。
export const HITFX = {
    MIN_DAMAGE: 2,            // 低於此傷害完全不觸發任何回饋（避免持續小擦撞抖個不停）

    // 震動（trauma 模型：受擊累加 trauma，每幀衰減，位移幅度 = trauma^2）。
    // 主鏡頭 alignWithScreen 開著時移動相機節點無效，所以改成「位移背景節點 (Canvas/bg)」來呈現震動。
    SHAKE_PER_DAMAGE: 0.07,  // 每點傷害換算的 trauma 增量（0~1）
    SHAKE_MAX_TRAUMA: 1.0,   // 單次累加後 trauma 上限
    SHAKE_MAX_OFFSET: 36,    // trauma=1 時背景的最大位移（px），越大震越明顯
    SHAKE_DECAY: 2.4,        // trauma 每秒衰減量（越大收得越快）
    SHAKE_FREQ: 40,          // 抖動頻率（越高越「銳」）

    // hitstop（短暫慢動作）：只有大擊／爆破
    HITSTOP_DAMAGE: 22,      // finalDmg 超過此值才觸發
    HITSTOP_SCALE: 0.08,     // 慢動作時的 timeScale
    HITSTOP_TIME: 0.06,      // 慢動作持續秒數（真實時間）

    // 撞擊火花（HitSpark）
    SPARK_MIN_DAMAGE: 4,     // 低於此傷害不噴火花
};

// 輪子滾動揚塵（WheelDust）：輪子貼地且轉得夠快時，在輪下節流冒出淡淡塵土小煙。
export const WHEELDUST = {
    MIN_SPIN: 600,        // 輪子角速度門檻（度/秒），低於此值不揚塵（避免靜止/慢速時亂冒）
    GROUND_PROBE: 6,      // 著地探測射線額外長度（同 AIR.GROUNDED_PROBE 風格）
    EMIT_INTERVAL: 0.08,  // 兩次揚塵的最小間隔（節流，約 12 次/秒）
};

// 槍口火光（MuzzleFlash）：武器發射時在槍口閃一下 + 幾條前向火光，方向沿子彈飛行方向。
export const MUZZLEFX = {
    MAX_STREAKS: 4,       // 前向火光條數
    FAN_DEG: 8,           // 火光條的扇形夾角（度）
};

// 加血方塊綠色溢光（HealGlow）：自我修復方塊回血中時，節流冒出綠色擴散光暈 + 上升綠點。
export const HEALFX = {
    EMIT_INTERVAL: 0.25,  // 回血中每隔多久冒一次綠光
};