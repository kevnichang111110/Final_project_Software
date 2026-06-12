import { BOT } from "../core/GameConstants";
import WeaponSystem from "./WeaponSystem";
import { BuiltCar } from "./CarBuilder";

export default class BotAI {
private wheelJoints: cc.WheelJoint[];
    private weaponJoints: cc.RevoluteJoint[];
    private wheelMultipliers: Map<cc.WheelJoint, number>;
    private gunNodes: cc.Node[];
    private gunFireInterval: number;
    private gunCooldown: number = 0;

    // 新增：儲存地圖邊界
    private boundary: { minX: number, maxX: number } | null = null;
    private currentMoveDir: number = 0;

    // 修改：建構子加入 boundary 參數
    constructor(car: BuiltCar, gunFireInterval: number, boundary: { minX: number, maxX: number } | null = null) {
        this.wheelJoints = car.wheelJoints;
        this.weaponJoints = car.weaponJoints;
        this.wheelMultipliers = car.wheelMultipliers;
        this.gunNodes = car.gunNodes;
        this.gunFireInterval = gunFireInterval;
        this.boundary = boundary; // 接收邊界資料
    }

    update(dt: number, playerRoot: cc.Node, botRoot: cc.Node, weapons: WeaponSystem) {
        if (!playerRoot || !botRoot) return;

        const distX = playerRoot.x - botRoot.x;
        const distY = playerRoot.y - botRoot.y;
        const absDistX = Math.abs(distX);

        // 修改：把 botRoot.x 傳入移動邏輯中，用來判斷絕對位置
        this.handleMovement(distX, absDistX, botRoot.x);
        this.handleMelee(absDistX);
        this.handleRanged(dt, distX, distY, weapons);
    }

    // --- 修改：移動邏輯加入邊界防護 ---
    private handleMovement(distX: number, absDistX: number, botX: number) {
        let targetMoveDir = 0;
        const buffer = 20; 

        // 1. 基本邏輯：根據玩家距離決定追擊或撤退
        if (absDistX > BOT.CHASE_DIST + buffer) {
            targetMoveDir = distX > 0 ? 1 : -1;
        } else if (absDistX < BOT.RETREAT_DIST - buffer) {
            targetMoveDir = distX > 0 ? -1 : 1;
        }

        // 2. 覆寫邏輯 (最高優先級)：邊界防護
        if (this.boundary) {
            const SAFE_MARGIN = 100; // 安全距離 (數值可依據你的地圖大小與車速調整，建議 100~200)
            if (botX < this.boundary.minX + SAFE_MARGIN) {
                targetMoveDir = 1; // 已經太靠左邊了，強制往右開！
            } else if (botX > this.boundary.maxX - SAFE_MARGIN) {
                targetMoveDir = -1; // 已經太靠右邊了，強制往左開！
            }
        }

        // 3. 更新馬達
        if (this.currentMoveDir !== targetMoveDir) {
            this.currentMoveDir = targetMoveDir;
            this.wheelJoints.forEach(j => {
                const mul = this.wheelMultipliers.get(j) ?? 1;
                j.motorSpeed = BOT.MOVE_SPEED * targetMoveDir * mul;
            });
        }
    }

    // --- 2. 近戰邏輯：加入角度容錯值 (Epsilon) ---
    private handleMelee(absDistX: number) {
        const EPSILON = 5; // 視你的單位而定 (如果是度數可以設 2~5，弧度則約 0.05)

        for (const j of this.weaponJoints) {
            const cur = j.getJointAngle();

            if (absDistX < BOT.ATTACK_RANGE) {
                // 進入攻擊範圍：加入容錯值，避免物理引擎反彈導致無法觸發極限判定
                if (cur <= j.lowerAngle + EPSILON) {
                    j.motorSpeed = BOT.ATTACK_SPEED;
                } else if (cur >= j.upperAngle - EPSILON) {
                    j.motorSpeed = -BOT.ATTACK_SPEED;
                }

                // 初次啟動攻擊
                if (j.motorSpeed === 0 || j.motorSpeed === BOT.RETURN_SPEED) {
                    j.motorSpeed = BOT.ATTACK_SPEED;
                }
            } else {
                // 脫離攻擊範圍：收回武器 (同樣避免無意義的每幀賦值)
                if (cur > j.lowerAngle + EPSILON) {
                    if (j.motorSpeed !== BOT.RETURN_SPEED) j.motorSpeed = BOT.RETURN_SPEED;
                } else {
                    if (j.motorSpeed !== 0) j.motorSpeed = 0; // 已收回到底就關閉馬達
                }
            }
        }
    }

    // --- 3. 遠程邏輯：加入射擊智商 (Y軸判斷) ---
    private handleRanged(dt: number, distX: number, distY: number, weapons: WeaponSystem) {
        this.gunCooldown = Math.max(0, this.gunCooldown - dt);

        if (this.gunNodes.length > 0 && this.gunCooldown <= 0) {
            // AI 簡單防呆：如果玩家飛得太高 (Y軸差太多)，或完全在背後，就先不開槍浪費子彈
            // (你可以依據遊戲設計決定是否需要這個限制)
            const isFacingPlayer = (this.currentMoveDir >= 0 && distX > 0) || (this.currentMoveDir <= 0 && distX < 0);
            const isYAxisAligned = Math.abs(distY) < 200; // 假設 200 是合理的射擊高度差

            if (isFacingPlayer && isYAxisAligned) {
                for (const gunNode of this.gunNodes) {
                    weapons.fireFrom(gunNode, "BOT");
                }
                this.gunCooldown = this.gunFireInterval;
            }
        }
    }
}
