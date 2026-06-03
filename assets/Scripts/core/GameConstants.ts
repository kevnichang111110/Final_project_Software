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
    WHEEL_MAX_TORQUE: 100000,
    WHEEL_TARGET_SPEED: -600,   // 玩家輪子目標馬達速度（乘上 moveDir）
    WHEEL_SMOOTHING: 0.15,      // 輪速插值平滑
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
    COLLISION_THRESHOLD: 200,   // 相對速度低於此值不造成碰撞傷害
    COLLISION_DIVISOR: 10,      // (相對速度 - 門檻) / 此值 = 傷害
    WEAPON_VS_WEAPON: 0.2,      // 武器互撞折扣
    SELF_WEAPON_MULT: 0.05,     // 我是武器去撞人，我受的傷
    OTHER_WEAPON_MULT: 4.0,     // 別人用武器撞我，我受的傷
    BULLET_VS_WEAPON: 0.5,      // 子彈打到武器部件的折扣
    MAX_PER_HIT: 50,            // 單次最大傷害
    MIN_TO_APPLY: 0.5,          // 低於此值的傷害忽略
    INVINCIBILITY: 0.1,         // 受擊後無敵時間
};
