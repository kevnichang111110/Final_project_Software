// battle/CarCtrl.ts
// 「逐車控制器」：把單一台車的完整操控邏輯（輪子/近戰/槍/滑鼠砲/噴射/自動翻正/爬牆/空中物理/卡住自救）
// 從 BattleManager 抽出來，做成可重複使用的物件。本地單機與線上對戰共用同一份控制邏輯：
//   - 本地：玩家車用一個 CarCtrl（鍵盤輸入）；敵方仍由 BotAI 直接驅動。
//   - 線上 host：兩台真人車各用一個 CarCtrl（己方鍵盤 / 對方網路輸入）。
//
// 輸入採「本地慣例」：worldDir A/左 = +1、D/右 = -1（與原 BattleManager.moveDir 一致），
// 確保本地手感完全不變；線上兩端都用本統一控制器，方向自然一致（不再有線上左右相反問題）。

import { JOINT, MELEE, MOUSE_TURRET, UPRIGHT, AIR, GROUP } from "../core/GameConstants";
import { BuiltCar } from "./CarBuilder";
import WeaponSystem from "./WeaponSystem";
import WallRide from "./WallRide";
import AirPhysics from "./AirPhysics";
import StuckRescue from "./StuckRescue";
import MouseCannon from "../weapons/MouseCannon";
import { OnlineInputState } from "../online/OnlineRuntime";

export type Side = "PLAYER" | "BOT";

export interface CarCtrlOptions {
    useWallRide?: boolean;
    useStuckRescue?: boolean;
    useAirPhysics?: boolean;   // 預設 true。鏡像車（線上 P2）關掉，避免 AirPhysics 對 scaleX=-1/旋轉車的計算把車塞進牆
    airBoundary?: cc.Vec2[] | null;
    enemyStart?: cc.Vec2;
    gunFireInterval?: number;
}

export default class CarCtrl {
    public car: BuiltCar;
    public root: cc.Node;
    public side: Side;
    public group: string;

    private weapons: WeaponSystem;
    private gunFireInterval: number;

    public wallRide: WallRide | null = null;
    public airPhysics: AirPhysics | null = null;
    public rescue: StuckRescue | null = null;

    private wheelSpeed = 0;
    private gunCooldown = 0;
    private cannonCooldown = 0;
    private meleeCooldown = 0;
    private meleeSwinging = false;
    private righting = false;

    constructor(car: BuiltCar, root: cc.Node, side: Side, weapons: WeaponSystem, opts: CarCtrlOptions = {}) {
        this.car = car;
        this.root = root;
        this.side = side;
        this.group = side === "PLAYER" ? GROUP.PLAYER_PART : GROUP.BOT_PART;
        this.weapons = weapons;
        this.gunFireInterval = opts.gunFireInterval != null ? opts.gunFireInterval : 0.25;

        this.wallRide = opts.useWallRide ? new WallRide(car, root, this.group) : null;
        this.airPhysics = (opts.useAirPhysics !== false) ? new AirPhysics(car, root, this.group) : null;
        if (this.airPhysics && opts.airBoundary) this.airPhysics.setBoundary(opts.airBoundary);
        this.rescue = opts.useStuckRescue
            ? new StuckRescue(car, root, this.group, opts.enemyStart || this.coreWorld() || cc.v2(0, 0))
            : null;
    }

    // 每幀依輸入操控這台車（沿用 BattleManager.update 內玩家車那一段的順序）
    update(input: OnlineInputState, dt: number, enemyCorePos: cc.Vec2 | null) {
        this.updateGun(dt, input);
        this.updateMovement(input);
        this.updateRescue(dt, input, enemyCorePos);

        if (this.wallRide) this.wallRide.update(dt);
        const onWall = !!(this.wallRide && this.wallRide.isEngaged());
        const grounded = this.isGrounded();
        const inAir = this.airPhysics ? this.airPhysics.update(dt, input.worldDir, grounded, onWall) : false;
        if (!inAir && !onWall) {
            this.updateAutoRight(grounded);
            this.updateJet(input);
        }
        this.updateMouseCannons(dt, input);
        this.updateMelee(dt, input);
    }

    public coreWorld(): cc.Vec2 | null {
        const c = this.car;
        if (!c || !c.coreNode || !c.coreNode.isValid) return null;
        return c.coreNode.convertToWorldSpaceAR(cc.v2(0, 0));
    }

    private updateGun(dt: number, input: OnlineInputState) {
        this.gunCooldown = Math.max(0, this.gunCooldown - dt);
        if (!this.car || !this.weapons) return;
        if (input.mouseDown && this.car.gunNodes.length > 0 && this.gunCooldown <= 0) {
            for (const gunNode of this.car.gunNodes) this.weapons.fireFrom(gunNode, this.side);
            this.gunCooldown = this.gunFireInterval;
        }
    }

    private updateMovement(input: OnlineInputState) {
        if (!this.car || this.car.wheelJoints.length === 0) return;
        const targetSpeed = input.worldDir * JOINT.WHEEL_TARGET_SPEED;
        this.wheelSpeed += (targetSpeed - this.wheelSpeed) * JOINT.WHEEL_SMOOTHING;
        for (const j of this.car.wheelJoints) {
            const mul = this.car.wheelMultipliers.get(j) ?? 1;
            j.motorSpeed = this.wheelSpeed * mul;
        }
    }

    private updateAutoRight(touching: boolean) {
        if (!UPRIGHT.ENABLED || !touching) { this.righting = false; return; }
        if (!this.car || !this.car.coreNode) { this.righting = false; return; }
        if (this.wallRide && this.wallRide.isEngaged()) { this.righting = false; return; }
        const core = this.car.coreNode;
        const rb = core.getComponent(cc.RigidBody);
        if (!rb) return;

        let ang = core.angle % 360;
        if (ang > 180) ang -= 360;
        if (ang < -180) ang += 360;

        const mag = Math.abs(ang);
        if (mag > UPRIGHT.TRIGGER_ANGLE) this.righting = true;
        else if (mag < UPRIGHT.RELEASE_ANGLE) this.righting = false;
        if (!this.righting) return;

        let torque = (-ang * UPRIGHT.GAIN) - rb.angularVelocity * UPRIGHT.DAMP;
        torque = cc.misc.clampf(torque, -UPRIGHT.MAX_TORQUE, UPRIGHT.MAX_TORQUE);
        (rb as any).applyTorque(torque, true);
    }

    private isGrounded(): boolean {
        if (!this.root || !this.root.isValid) return false;
        const pm = cc.director.getPhysicsManager();
        const bodies = this.root.getComponentsInChildren(cc.RigidBody);
        for (const rb of bodies) {
            const node = rb.node;
            if (!node || !node.isValid || node.group !== this.group) continue;
            const o = node.convertToWorldSpaceAR(cc.v2(0, 0));
            const len = Math.max(node.width, node.height, 40) * 0.5 + AIR.GROUNDED_PROBE;
            const results = pm.rayCast(cc.v2(o.x, o.y), cc.v2(o.x, o.y - len), cc.RayCastType.All);
            for (const r of results) {
                const g = r.collider.node.group;
                if (g === GROUP.DEFAULT || g === GROUP.BOUNDARY) return true;
            }
        }
        return false;
    }

    private updateRescue(dt: number, input: OnlineInputState, enemyCorePos: cc.Vec2 | null) {
        if (this.rescue) this.rescue.update(dt, input.worldDir !== 0, enemyCorePos);
    }

    private updateJet(input: OnlineInputState) {
        if (!input.boost || !this.car) return;
        for (const ab of this.car.wheelAbilities) {
            if (ab && ab.applyJet) ab.applyJet();
        }
    }

    private updateMelee(dt: number, input: OnlineInputState) {
        if (!this.car || this.car.weaponJoints.length === 0) return;
        const hasWheel = this.car.wheelJoints.length > 0;

        if (this.meleeCooldown > 0) this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);

        if (!this.meleeSwinging && input.attack && this.meleeCooldown <= 0) {
            this.meleeSwinging = true;
            this.meleeCooldown = MELEE.COOLDOWN;
        }

        let allReachedTop = true;
        for (const j of this.car.weaponJoints) {
            j.enableMotor = hasWheel;
            const cur = j.getJointAngle();
            if (this.meleeSwinging) {
                if (cur < j.upperAngle - MELEE.REACH_TOLERANCE) {
                    j.motorSpeed = JOINT.MELEE_ATTACK_SPEED;
                    allReachedTop = false;
                } else {
                    j.motorSpeed = 0;
                }
            } else {
                j.motorSpeed = cur > j.lowerAngle ? JOINT.MELEE_RETURN_SPEED : 0;
            }
        }
        if (this.meleeSwinging && allReachedTop) this.meleeSwinging = false;
    }

    private updateMouseCannons(dt: number, input: OnlineInputState) {
        this.cannonCooldown = Math.max(0, this.cannonCooldown - dt);
        if (!this.car || !this.weapons) return;
        const cannons = this.car.mouseCannons;
        if (cannons.length === 0) return;

        const target = cc.v2(input.mouseX, input.mouseY);
        for (const c of cannons) {
            if (c.node && c.node.isValid) this.aimTurret(c, dt, target);
        }

        if (!input.mouseDown || this.cannonCooldown > 0) return;
        let interval = 0.18;
        for (const c of cannons) {
            if (!c.node || !c.node.isValid) continue;
            const mc = c.node.getComponent(MouseCannon);
            if (mc) interval = mc.fireInterval;
            this.weapons.fireFrom(c.node, this.side, {
                speed: mc ? mc.bulletSpeed : undefined,
                damage: mc ? mc.bulletDamage : undefined,
                lifetime: mc ? mc.bulletLifetime : undefined,
                damagesAll: !!mc,
            });
            const audio = c.node.getComponent("PartAudio") as any;
            if (audio && audio.playAttack) audio.playAttack();
        }
        this.cannonCooldown = interval;
    }

    // 砲管轉向指定世界座標（直接設角度，每幀以 AIM_SPEED 為上限）
    private aimTurret(c: { node: cc.Node, joint: cc.RevoluteJoint, mountOffset: number }, dt: number, targetWorld: cc.Vec2) {
        const weaponNode = c.node, joint = c.joint;
        if (!joint || !joint.isValid) return;
        const weaponRb = weaponNode.getComponent(cc.RigidBody);
        const parent = joint.node;
        if (!weaponRb || !parent || !parent.isValid) return;

        const center = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        const fp = weaponNode.getChildByName("firepoint");
        const muzzle = fp
            ? fp.convertToWorldSpaceAR(cc.v2(0, 0))
            : weaponNode.convertToWorldSpaceAR(cc.v2(40, 0));
        const cur = Math.atan2(muzzle.y - center.y, muzzle.x - center.x) * 180 / Math.PI;

        const toTarget = targetWorld.sub(center);
        if (toTarget.mag() < 1) return;
        const aim = Math.atan2(toTarget.y, toTarget.x) * 180 / Math.PI;

        let err = aim - cur;
        while (err > 180) err -= 360; while (err < -180) err += 360;

        // 旋轉方向手性：weaponNode.angle 的旋轉套在「場景父節點」的座標系裡，所以要量
        // 父節點（root）的手性，而不是武器節點自己——逐零件的 scaleX=-1（線上 P2 鏡像）
        // 只翻轉砲管靜止朝向（已被 cur 量到），不影響旋轉方向。量錯成節點自身會讓 P2 反向。
        // 只有 root 本身被鏡像（scaleX<0）時才需要反號；目前 P1/P2 的 root 皆未鏡像 → sign=1。
        let sign = 1;
        const par = weaponNode.parent;
        if (par) {
            const pc = par.convertToWorldSpaceAR(cc.v2(0, 0));
            const px = par.convertToWorldSpaceAR(cc.v2(1, 0)).sub(pc);
            const py = par.convertToWorldSpaceAR(cc.v2(0, 1)).sub(pc);
            if (px.x * py.y - px.y * py.x < 0) sign = -1;
        }

        const maxStep = MOUSE_TURRET.AIM_SPEED * dt;
        weaponNode.angle += cc.misc.clampf(err * sign, -maxStep, maxStep);
        weaponRb.angularVelocity = 0;
        const anyRb = weaponRb as any;
        if (anyRb.syncRotation) anyRb.syncRotation(false);
    }
}
