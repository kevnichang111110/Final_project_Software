import { BATTLE, GROUP, JOINT, MELEE, MOUSE_TURRET } from "../core/GameConstants";
import CarBuilder, { BuiltCar } from "../battle/CarBuilder";
import WeaponSystem from "../battle/WeaponSystem";
import MapLoader from "../map/MapLoader";
import MouseCannon from "../weapons/MouseCannon";
import Health from "../HealthManager";
import OnlineRuntime, { OnlineInputState, OnlineSeat } from "./OnlineRuntime";

const { ccclass, property } = cc._decorator;

type SideGroup = "PLAYER" | "BOT";

@ccclass
export default class OnlineBattleManager extends cc.Component {
    @property(cc.Label) timerLabel: cc.Label | null = null;
    @property(cc.Label) countdownLabel: cc.Label | null = null;
    @property(cc.Label) resultLabel: cc.Label | null = null;
    @property([cc.Prefab]) allPrefabs: cc.Prefab[] = [];
    @property(cc.Prefab) bulletPrefab: cc.Prefab | null = null;
    @property(MapLoader) mapLoader: MapLoader | null = null;

    @property gunFireInterval: number = 0.25;
    @property bulletSpeed: number = 1600;
    @property bulletDamage: number = 20;
    @property bulletLifetime: number = 3;

    private p1Root: cc.Node | null = null;
    private p2Root: cc.Node | null = null;
    private p1Car: BuiltCar | null = null;
    private p2Car: BuiltCar | null = null;
    private weapons: WeaponSystem | null = null;

    private p1Input: OnlineInputState = OnlineRuntime.defaultInput();
    private p2Input: OnlineInputState = OnlineRuntime.defaultInput();
    private p1GunCooldown: number = 0;
    private p2GunCooldown: number = 0;
    private p1MouseCooldown: number = 0;
    private p2MouseCooldown: number = 0;
    private p1MeleeCooldown: number = 0;
    private p2MeleeCooldown: number = 0;

    private leftDown: boolean = false;
    private rightDown: boolean = false;
    private myInput: OnlineInputState = OnlineRuntime.defaultInput();
    private sendTimer: number = 0;

    private matchTimer: number = BATTLE.MATCH_TIME;
    private countdownValue: number = BATTLE.COUNTDOWN_FROM;
    private countdownTimer: number = 0;
    private isBattleStarted: boolean = false;
    private isGameOver: boolean = false;
    private sentRoundOver: boolean = false;

    private p1ScoreLabel: cc.Label | null = null;
    private p2ScoreLabel: cc.Label | null = null;

    onLoad() {
        if (!OnlineRuntime.room) {
            cc.error("[OnlineBattleManager] no room. Return to Menu.");
            cc.director.loadScene(OnlineRuntime.menuSceneName);
            return;
        }

        Health.activeInBattle = true;
        const physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        (physics as any).enabledContactListener = true;
        physics.enabledAccumulator = true;

        this.createScoreboard();
        this.setupBattle();
        this.bindInput();
        this.bindNetworkEvents();
    }

    onDestroy() {
        Health.activeInBattle = false;
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
        cc.systemEvent.off("ONLINE_REMOTE_INPUT", this.onRemoteInput, this);
        cc.systemEvent.off("ONLINE_ROUND_RESULT", this.onRoundResult, this);
        cc.systemEvent.off("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);

        const mouseTarget = cc.find("Canvas") || this.node;
        if (mouseTarget) {
            mouseTarget.off(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this, true);
            mouseTarget.off(cc.Node.EventType.MOUSE_DOWN, this.onMouseDown, this, true);
            mouseTarget.off(cc.Node.EventType.MOUSE_UP, this.onMouseUp, this, true);
        }
    }

    private setupBattle() {
        this.matchTimer = BATTLE.MATCH_TIME;
        this.countdownValue = BATTLE.COUNTDOWN_FROM;
        this.countdownTimer = 0;
        this.isBattleStarted = false;
        this.isGameOver = false;
        this.sentRoundOver = false;

        if (this.resultLabel) this.resultLabel.node.active = false;
        if (this.timerLabel) this.timerLabel.string = String(BATTLE.MATCH_TIME);
        if (this.countdownLabel) {
            this.countdownLabel.node.active = true;
            this.countdownLabel.string = String(BATTLE.COUNTDOWN_FROM);
        }

        this.p1Root = new cc.Node("P1_ROOT");
        this.p1Root.parent = this.node;
        this.p2Root = new cc.Node("P2_ROOT");
        this.p2Root.parent = this.node;

        this.weapons = new WeaponSystem(this.bulletPrefab, this.node, {
            speed: this.bulletSpeed,
            damage: this.bulletDamage,
            lifetime: this.bulletLifetime,
        });

        this.p1Car = CarBuilder.build({
            gridData: OnlineRuntime.p1Grid,
            startPos: cc.v2(300, 0),
            side: "PLAYER",
            root: this.p1Root,
            prefabs: this.allPrefabs,
            onCoreDie: () => this.reportRoundOver("P2")
        });

        this.p2Car = CarBuilder.build({
            gridData: OnlineRuntime.p2Grid,
            startPos: cc.v2(-300, 50),
            side: "BOT",
            root: this.p2Root,
            prefabs: this.allPrefabs,
            onCoreDie: () => this.reportRoundOver("P1")
        });

        // 讓兩邊載入同一張隨機地圖。MapLoader 內建 seed；0 會每局不同，非 0 可重現。
        if (this.mapLoader) {
            (this.mapLoader as any).seed = OnlineRuntime.seed || 1;
            this.mapLoader.loadRandomMap();
        }

        this.startAllPhysics(false);
        this.updateScoreboard();
    }

    private bindInput() {
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);

        const mouseTarget = cc.find("Canvas") || this.node;
        if (mouseTarget) {
            mouseTarget.on(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this, true);
            mouseTarget.on(cc.Node.EventType.MOUSE_DOWN, this.onMouseDown, this, true);
            mouseTarget.on(cc.Node.EventType.MOUSE_UP, this.onMouseUp, this, true);
        }
    }

    private bindNetworkEvents() {
        cc.systemEvent.on("ONLINE_REMOTE_INPUT", this.onRemoteInput, this);
        cc.systemEvent.on("ONLINE_ROUND_RESULT", this.onRoundResult, this);
        cc.systemEvent.on("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);
    }

    update(dt: number) {
        if (this.isGameOver) return;

        this.sendTimer += dt;
        if (this.sendTimer >= 0.05) {
            this.sendTimer = 0;
            this.sendMyInput();
        }

        if (!this.isBattleStarted) {
            this.updateCountdown(dt);
            return;
        }

        this.matchTimer -= dt;
        if (this.timerLabel) this.timerLabel.string = String(Math.max(0, Math.ceil(this.matchTimer)));
        if (this.matchTimer <= 0 && OnlineRuntime.isHost()) {
            this.applySuddenDeath(dt);
        }

        this.p1GunCooldown = Math.max(0, this.p1GunCooldown - dt);
        this.p2GunCooldown = Math.max(0, this.p2GunCooldown - dt);
        this.p1MouseCooldown = Math.max(0, this.p1MouseCooldown - dt);
        this.p2MouseCooldown = Math.max(0, this.p2MouseCooldown - dt);
        this.p1MeleeCooldown = Math.max(0, this.p1MeleeCooldown - dt);
        this.p2MeleeCooldown = Math.max(0, this.p2MeleeCooldown - dt);

        this.applyCarControl(this.p1Car, this.p1Input, "PLAYER", 1, dt);
        this.applyCarControl(this.p2Car, this.p2Input, "BOT", 2, dt);
    }

    private updateCountdown(dt: number) {
        this.countdownTimer += dt;
        if (this.countdownTimer < 1) return;
        this.countdownTimer = 0;
        this.countdownValue--;

        if (this.countdownValue > 0) {
            if (this.countdownLabel) this.countdownLabel.string = String(this.countdownValue);
        } else {
            this.isBattleStarted = true;
            this.startAllPhysics(true);
            if (this.countdownLabel) {
                this.countdownLabel.string = "FIGHT!";
                this.scheduleOnce(() => {
                    if (this.countdownLabel) this.countdownLabel.node.active = false;
                }, 1);
            }
        }
    }

    private startAllPhysics(dynamic: boolean) {
        const setRoot = (root: cc.Node | null) => {
            if (!root) return;
            root.getComponentsInChildren(cc.RigidBody).forEach(rb => {
                rb.type = dynamic ? cc.RigidBodyType.Dynamic : cc.RigidBodyType.Static;
                rb.linearVelocity = cc.v2(0, 0);
                rb.angularVelocity = 0;
                rb.awake = true;
            });
        };
        setRoot(this.p1Root);
        setRoot(this.p2Root);
    }

    private applyCarControl(car: BuiltCar | null, input: OnlineInputState, side: SideGroup, index: number, dt: number) {
        if (!car) return;

        // worldDir: -1 left, +1 right. P1/P2 用同一套世界方向，車體鏡像由 CarBuilder.side 處理。
        const targetSpeed = input.worldDir * Math.abs(JOINT.WHEEL_TARGET_SPEED);
        for (const j of car.wheelJoints) {
            const mul = car.wheelMultipliers.get(j) || 1;
            j.motorSpeed = targetSpeed * mul;
        }

        this.updateMelee(car, input, index);
        this.updateGuns(car, input, side, index);
        this.updateMouseCannons(car, input, side, index, dt);
    }

    private updateMelee(car: BuiltCar, input: OnlineInputState, index: number) {
        const cooldown = index === 1 ? this.p1MeleeCooldown : this.p2MeleeCooldown;
        if (!input.attack || cooldown > 0) {
            for (const j of car.weaponJoints) {
                const cur = j.getJointAngle();
                if (cur > j.lowerAngle + MELEE.REACH_TOLERANCE) {
                    j.motorSpeed = JOINT.MELEE_RETURN_SPEED;
                }
            }
            return;
        }

        for (const j of car.weaponJoints) {
            const cur = j.getJointAngle();
            if (cur <= j.lowerAngle + MELEE.REACH_TOLERANCE) {
                j.motorSpeed = JOINT.MELEE_ATTACK_SPEED;
            } else if (cur >= j.upperAngle - MELEE.REACH_TOLERANCE) {
                j.motorSpeed = JOINT.MELEE_RETURN_SPEED;
            }
        }

        if (index === 1) this.p1MeleeCooldown = MELEE.COOLDOWN;
        else this.p2MeleeCooldown = MELEE.COOLDOWN;
    }

    private updateGuns(car: BuiltCar, input: OnlineInputState, side: SideGroup, index: number) {
        if (!this.weapons || !input.mouseDown || car.gunNodes.length === 0) return;
        const cooldown = index === 1 ? this.p1GunCooldown : this.p2GunCooldown;
        if (cooldown > 0) return;

        for (const gun of car.gunNodes) {
            this.weapons.fireFrom(gun, side);
        }

        if (index === 1) this.p1GunCooldown = this.gunFireInterval;
        else this.p2GunCooldown = this.gunFireInterval;
    }

    private updateMouseCannons(car: BuiltCar, input: OnlineInputState, side: SideGroup, index: number, _dt: number) {
        if (!this.weapons || car.mouseCannons.length === 0) return;

        for (const c of car.mouseCannons) {
            this.aimTurret(c, cc.v2(input.mouseX, input.mouseY));
        }

        if (!input.mouseDown) return;
        const cooldown = index === 1 ? this.p1MouseCooldown : this.p2MouseCooldown;
        if (cooldown > 0) return;

        let interval = 0.18;
        for (const c of car.mouseCannons) {
            if (!c.node || !c.node.isValid) continue;
            const mc = c.node.getComponent(MouseCannon);
            if (mc) interval = mc.fireInterval;
            this.weapons.fireFrom(c.node, side, {
                speed: mc ? mc.bulletSpeed : undefined,
                damage: mc ? mc.bulletDamage : undefined,
                lifetime: mc ? mc.bulletLifetime : undefined,
                damagesAll: !!mc
            });
        }

        if (index === 1) this.p1MouseCooldown = interval;
        else this.p2MouseCooldown = interval;
    }

    private aimTurret(c: { node: cc.Node, joint: cc.RevoluteJoint, mountOffset: number }, targetWorld: cc.Vec2) {
        const weaponNode = c.node;
        const joint = c.joint;
        if (!joint || !joint.isValid) return;
        const weaponRb = weaponNode.getComponent(cc.RigidBody);
        const parent = joint.node;
        if (!weaponRb || !parent || !parent.isValid) return;

        const center = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        const fp = weaponNode.getChildByName("firepoint");
        const muzzle = fp ? fp.convertToWorldSpaceAR(cc.v2(0, 0)) : weaponNode.convertToWorldSpaceAR(cc.v2(40, 0));
        const cur = Math.atan2(muzzle.y - center.y, muzzle.x - center.x) * 180 / Math.PI;

        const toTarget = targetWorld.sub(center);
        if (toTarget.mag() < 1) return;
        const aim = Math.atan2(toTarget.y, toTarget.x) * 180 / Math.PI;

        const base = parent.angle + c.mountOffset;
        let off = aim - base;
        while (off > 180) off -= 360;
        while (off < -180) off += 360;
        off = cc.misc.clampf(off, -MOUSE_TURRET.HALF_ARC, MOUSE_TURRET.HALF_ARC);
        const target = base + off;

        let err = target - cur;
        while (err > 180) err -= 360;
        while (err < -180) err += 360;
        weaponRb.angularVelocity = cc.misc.clampf(err * MOUSE_TURRET.AIM_GAIN, -MOUSE_TURRET.AIM_SPEED, MOUSE_TURRET.AIM_SPEED);
    }

    private applySuddenDeath(dt: number) {
        // 主機判定驟死。簡化版：時間到後雙方核心持續扣血，誰先爆由 P1 主機回報。
        if (this.p1Car && this.p1Car.coreHealth) this.p1Car.coreHealth.takeDamage(BATTLE.PLAYER_CORE_DOT * dt);
        if (this.p2Car && this.p2Car.coreHealth) this.p2Car.coreHealth.takeDamage(BATTLE.BOT_CORE_DOT * dt);
    }

    private reportRoundOver(winner: OnlineSeat) {
        if (!OnlineRuntime.isHost()) return;
        if (this.sentRoundOver) return;
        this.sentRoundOver = true;
        OnlineRuntime.room.send("roundOver", { winner });
    }

    private onRoundResult(msg: any) {
        if (this.isGameOver) return;
        this.isGameOver = true;
        this.startAllPhysics(false);
        this.updateScoreboard();

        const winner = msg && msg.winner === "P2" ? "P2" : "P1";
        const iWon = winner === OnlineRuntime.mySeat;
        const matchOver = !!(msg && msg.matchOver);

        if (this.resultLabel) {
            this.resultLabel.node.active = true;
            this.resultLabel.string = matchOver
                ? (iWon ? "VICTORY" : "DEFEAT")
                : `${winner} WIN!`;
            this.resultLabel.node.color = iWon ? cc.Color.YELLOW : cc.Color.WHITE;
        }

        this.scheduleOnce(() => {
            if (matchOver) {
                const room = OnlineRuntime.room;
                if (room) room.leave();
                OnlineRuntime.clearMatch();
                cc.director.loadScene(OnlineRuntime.menuSceneName);
            } else {
                cc.director.loadScene(OnlineRuntime.shopSceneName);
            }
        }, 3);
    }

    private onRemoteInput(msg: any) {
        if (!msg || !msg.seat || !msg.input) return;

        cc.log(`[Network] 收到來自 ${msg.seat} 的輸入: ${msg.input.worldDir}`);
        const input = this.normalizeInput(msg.input);
        if (msg.seat === "P1") this.p1Input = input;
        else this.p2Input = input;
    }

    private onOpponentLeft() {
        if (this.resultLabel) {
            this.resultLabel.node.active = true;
            this.resultLabel.string = "對手離線";
        }
        this.scheduleOnce(() => cc.director.loadScene(OnlineRuntime.menuSceneName), 2);
    }

    private normalizeInput(raw: any): OnlineInputState {
        return {
            worldDir: Math.max(-1, Math.min(1, Number(raw.worldDir || 0))),
            attack: !!raw.attack,
            boost: !!raw.boost,
            mouseDown: !!raw.mouseDown,
            mouseX: Number(raw.mouseX || 0),
            mouseY: Number(raw.mouseY || 0)
        };
    }

    private sendMyInput() {
        if (!OnlineRuntime.room) return;
        if (OnlineRuntime.mySeat === "P1") this.p1Input = this.myInput;
        else this.p2Input = this.myInput;
        cc.log(`[Network] 我是 ${OnlineRuntime.mySeat}，正在發送輸入: ${this.myInput.worldDir}`);
        OnlineRuntime.room.send("input", this.myInput);
    }

    private onKeyDown(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
                this.leftDown = true;
                break;
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                this.rightDown = true;
                break;
            case cc.macro.KEY.space:
                this.myInput.attack = true;
                break;
            case cc.macro.KEY.w:
            case cc.macro.KEY.up:
                this.myInput.boost = true;
                break;
        }
        this.refreshMoveDir();
    }

    private onKeyUp(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
                this.leftDown = false;
                break;
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                this.rightDown = false;
                break;
            case cc.macro.KEY.space:
                this.myInput.attack = false;
                break;
            case cc.macro.KEY.w:
            case cc.macro.KEY.up:
                this.myInput.boost = false;
                break;
        }
        this.refreshMoveDir();
    }

    private refreshMoveDir() {
        if (this.leftDown && !this.rightDown) this.myInput.worldDir = -1;
        else if (this.rightDown && !this.leftDown) this.myInput.worldDir = 1;
        else this.myInput.worldDir = 0;
    }

    private onMouseMove(event: cc.Event.EventMouse) {
        const canvas = cc.find("Canvas") || this.node;
        const loc = event.getLocation();
        const world = canvas.convertToWorldSpaceAR(canvas.convertToNodeSpaceAR(loc));
        this.myInput.mouseX = world.x;
        this.myInput.mouseY = world.y;
    }

    private onMouseDown(event: cc.Event.EventMouse) {
        if (event.getButton && event.getButton() !== cc.Event.EventMouse.BUTTON_LEFT) return;
        this.myInput.mouseDown = true;
        this.onMouseMove(event);
    }

    private onMouseUp(_event: cc.Event.EventMouse) {
        this.myInput.mouseDown = false;
    }

    private createScoreboard() {
        const canvas = cc.find("Canvas");
        if (!canvas) return;
        this.p1ScoreLabel = this.makeCornerLabel(canvas, "P1_SCORE", true, cc.color(120, 200, 255));
        this.p2ScoreLabel = this.makeCornerLabel(canvas, "P2_SCORE", false, cc.color(255, 150, 90));
        this.updateScoreboard();
    }

    private makeCornerLabel(canvas: cc.Node, name: string, left: boolean, color: cc.Color): cc.Label {
        const node = new cc.Node(name);
        node.parent = canvas;
        node.zIndex = 100;
        node.color = color;

        const label = node.addComponent(cc.Label);
        label.fontSize = 40;
        label.lineHeight = 44;
        label.horizontalAlign = left ? cc.Label.HorizontalAlign.LEFT : cc.Label.HorizontalAlign.RIGHT;

        const widget = node.addComponent(cc.Widget);
        widget.isAlignTop = true;
        widget.top = 24;
        if (left) {
            widget.isAlignLeft = true;
            widget.left = 30;
            node.anchorX = 0;
        } else {
            widget.isAlignRight = true;
            widget.right = 30;
            node.anchorX = 1;
        }
        widget.updateAlignment();
        return label;
    }

    private updateScoreboard() {
        if (this.p1ScoreLabel) this.p1ScoreLabel.string = `P1  ${OnlineRuntime.p1Wins}`;
        if (this.p2ScoreLabel) this.p2ScoreLabel.string = `${OnlineRuntime.p2Wins}  P2`;
    }
}
