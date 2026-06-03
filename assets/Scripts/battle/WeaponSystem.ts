// battle/WeaponSystem.ts
// 原本 BattleManager 的 fireBulletFromWeapon / createBulletNode。
// 負責「從某個武器節點朝槍口方向產生一顆子彈」，玩家與 Bot 共用同一套。
// 由 BattleManager 在 setupBattle 時建立一個實例並注入子彈 prefab 與參數。

import Bullet from "../Bullet";
import { GROUP } from "../core/GameConstants";

export interface BulletConfig {
    speed: number;
    damage: number;
    lifetime: number;
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

    // 從武器節點開火。方向 = 槍口(firepoint) 世界座標 - 武器中心世界座標，
    // 這樣不管箭頭怎麼旋轉/縮放，向量永遠由屁股指向尖端。
    fireFrom(weaponNode: cc.Node, side: "PLAYER" | "BOT") {
        if (!weaponNode || !weaponNode.isValid) return;

        const originWorld = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));

        const firePoint = weaponNode.getChildByName("firepoint");
        const muzzleWorld = firePoint
            ? firePoint.convertToWorldSpaceAR(cc.v2(0, 0))
            : weaponNode.convertToWorldSpaceAR(cc.v2(40, 0)); // 沒做 firepoint 時的保底

        let dir = muzzleWorld.sub(originWorld).normalize();
        if (dir.mag() < 0.1) {
            dir = side === "PLAYER" ? cc.v2(-1, 0) : cc.v2(1, 0); // 重疊時的保底方向
        }

        this.createBullet(side, muzzleWorld, dir);
    }

    private createBullet(side: "PLAYER" | "BOT", worldPos: cc.Vec2, dir: cc.Vec2): cc.Node | null {
        if (!this.bulletPrefab) {
            cc.error("WeaponSystem: 未綁定子彈 Prefab！");
            return null;
        }

        const bullet = cc.instantiate(this.bulletPrefab);
        bullet.group = side === "PLAYER" ? GROUP.PLAYER_BULLET : GROUP.BOT_BULLET;
        bullet.angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
        bullet.parent = this.container;
        bullet.setPosition(this.container.convertToNodeSpaceAR(worldPos));
        bullet.zIndex = 5;

        const rb = bullet.getComponent(cc.RigidBody);
        if (rb) {
            rb.linearVelocity = cc.v2(dir.x * this.config.speed, dir.y * this.config.speed);
        }

        const comp = bullet.getComponent(Bullet);
        if (comp) {
            comp.ownerSide = side;
            comp.damage = this.config.damage;
            comp.lifeTime = this.config.lifetime;
        }
        return bullet;
    }
}
