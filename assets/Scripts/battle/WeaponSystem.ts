// battle/WeaponSystem.ts
// 子彈發射系統，玩家與 Bot 共用。
//   fireFrom(weaponNode, side)               → 朝武器自身槍口方向射擊（一般槍）
//   fireTowards(weaponNode, side, target, o) → 朝指定世界座標射擊（滑鼠砲），可帶 per-shot 覆寫

import Bullet from "../Bullet";
import NodePool from "../core/NodePool";
import MuzzleFlash from "../fx/MuzzleFlash";
import { GROUP } from "../core/GameConstants";

// 子彈池：module-level singleton，跨回合 / 跨場景存活（回收的節點已脫離場景樹，換場景不被銷毀）。
// 以發射時的 prefab 建立；prefab 換了（理論上不會）才重建。
let bulletPool: NodePool | null = null;
let bulletPoolPrefab: cc.Prefab | null = null;
function getBulletPool(prefab: cc.Prefab): NodePool {
    if (!bulletPool || bulletPoolPrefab !== prefab) {
        bulletPoolPrefab = prefab;
        bulletPool = new NodePool(() => cc.instantiate(prefab));
    }
    return bulletPool;
}

// 把一個子彈節點收回池子（供 Bullet.recycler 與 BattleManager 回合結束清掃共用）。
export function recycleBullet(node: cc.Node): void {
    if (bulletPool) bulletPool.put(node);
    else if (node && node.isValid) node.destroy();
}

export interface BulletConfig {
    speed: number;
    damage: number;
    lifetime: number;
}

// 單發覆寫（滑鼠砲用：自己的速度/傷害/存活時間，且無差別傷害）
export interface ShotOverride {
    speed?: number;
    damage?: number;
    lifetime?: number;
    damagesAll?: boolean;
}

export default class WeaponSystem {
    private bulletPrefab: cc.Prefab | null;
    private container: cc.Node;   // 子彈掛載的父節點（BattleManager.node）
    private config: BulletConfig;

    constructor(bulletPrefab: cc.Prefab | null, container: cc.Node, config: BulletConfig) {
        this.bulletPrefab = bulletPrefab;
        this.container = container;
        this.config = config;
    }

    // 朝武器槍口方向射擊（方向 = 槍口 firepoint - 武器中心）
    fireFrom(weaponNode: cc.Node, side: "PLAYER" | "BOT", override?: ShotOverride) {
        if (!weaponNode || !weaponNode.isValid) return;

        const originWorld = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        const firePoint = weaponNode.getChildByName("firepoint");
        const muzzleWorld = firePoint
            ? firePoint.convertToWorldSpaceAR(cc.v2(0, 0))
            : weaponNode.convertToWorldSpaceAR(cc.v2(40, 0));

        let dir = muzzleWorld.sub(originWorld).normalize();
        if (dir.mag() < 0.1) dir = side === "PLAYER" ? cc.v2(-1, 0) : cc.v2(1, 0);

        this.createBullet(side, muzzleWorld, dir, override);
    }

    // 朝某個世界座標射擊（滑鼠砲）。子彈從 firepoint（或武器中心朝目標前方一點）射出。
    fireTowards(weaponNode: cc.Node, side: "PLAYER" | "BOT", worldTarget: cc.Vec2, override?: ShotOverride) {
        if (!weaponNode || !weaponNode.isValid) return;

        const center = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        let dir = worldTarget.sub(center).normalize();
        if (dir.mag() < 0.1) dir = side === "PLAYER" ? cc.v2(-1, 0) : cc.v2(1, 0);

        const firePoint = weaponNode.getChildByName("firepoint");
        const muzzle = firePoint
            ? firePoint.convertToWorldSpaceAR(cc.v2(0, 0))
            : center.add(dir.mul(45)); // 沒 firepoint 時，往前 45px 避免一出生就打到自己

        this.createBullet(side, muzzle, dir, override);
    }

    private createBullet(side: "PLAYER" | "BOT", worldPos: cc.Vec2, dir: cc.Vec2, override?: ShotOverride): cc.Node | null {
        if (!this.bulletPrefab) {
            cc.error("WeaponSystem: 未綁定子彈 Prefab！");
            return null;
        }

        const speed = override && override.speed != null ? override.speed : this.config.speed;
        const damage = override && override.damage != null ? override.damage : this.config.damage;
        const lifetime = override && override.lifetime != null ? override.lifetime : this.config.lifetime;
        const damagesAll = !!(override && override.damagesAll);

        const pool = getBulletPool(this.bulletPrefab);
        const bullet = pool.get();
        bullet.active = true;
        bullet.group = side === "PLAYER" ? GROUP.PLAYER_BULLET : GROUP.BOT_BULLET;
        bullet.angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
        bullet.parent = this.container;
        bullet.setPosition(this.container.convertToNodeSpaceAR(worldPos));
        bullet.zIndex = 5;

        const rb = bullet.getComponent(cc.RigidBody);
        if (rb) {
            rb.linearVelocity = cc.v2(dir.x * speed, dir.y * speed);
            rb.angularVelocity = 0;   // 重用節點：清掉殘留角速度
        }

        const comp = bullet.getComponent(Bullet);
        if (comp) {
            comp.ownerSide = side;
            comp.damage = damage;
            comp.lifeTime = lifetime;
            comp.damagesAll = damagesAll;
            comp.recycler = recycleBullet;   // 命中/逾時時收回池子而非 destroy
            comp.arm();                       // 重置 hasExploded + 重新開始存活倒數
        }

        // 槍口火光（玩家與 Bot 共用此路徑；發射冷卻已節流，每發一閃）。
        // 掛在 container（BattleManager.node）→ 武器被銷毀後特效仍在。
        MuzzleFlash.spawn(this.container, worldPos, dir);
        return bullet;
    }
}