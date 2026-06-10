// battle/CarBuilder.ts
// 原本 BattleManager.spawnGridCar + handlePartDisjoint。
// 負責「依網格資料把一台車生出來、掛血量、接好所有關節」，
// 並把建立結果（核心血量、槍械、各種 joint）打包回傳，讓 BattleManager / BotAI 使用。

import GameManager from "../GameManager";
import { GROUP, BATTLE, GRID, MOUSE_TURRET, HITFX, JOINT, PHYSICS } from "../core/GameConstants";
import { PartType, WeaponMode } from "../core/PartType";
import {
    isCoreNode, isBodyLikeNode, isWheelNode, isWeaponNode, getPrefabByName, getDraggable,
} from "../core/PartUtils";
import JointFactory from "./JointFactory";
import Explosion from "./Explosion";
import HitFeedback from "../fx/HitFeedback";
import Health from "../HealthManager";
import MouseCannon from "../weapons/MouseCannon";

// FIXME: Car的馬力太低，爬牆/爬斜坡能力太差了。之後要調整數值或改成「輪子接得更緊」的關節設定，讓車子更有力。

// 一台車建好後對外提供的資料
export interface BuiltCar {
    partsMap: Map<string, cc.Node>;
    coreHealth: Health | null;
    coreNode: cc.Node | null;        // 核心節點（空中旋轉施力用）
    gunNodes: cc.Node[];
    wheelJoints: cc.WheelJoint[];
    weaponJoints: cc.RevoluteJoint[];
    wheelMultipliers: Map<cc.WheelJoint, number>;
    wheelAbilities: any[];           // WheelAbility[]（噴射/彈跳）
    // 滑鼠砲：節點 + 旋轉關節 + 建立當下「砲管世界角 − 母體世界角」（弧度中心，瞄準夾角用）
    mouseCannons: { node: cc.Node, joint: cc.RevoluteJoint, mountOffset: number }[];
}

export interface BuildParams {
    gridData: any[];
    startPos: cc.Vec2;
    side: "PLAYER" | "BOT";
    root: cc.Node;
    prefabs: cc.Prefab[];
    onCoreDie: (winner: "PLAYER" | "BOT") => void;  // 核心被打爆時通知 BattleManager
}

export default class CarBuilder {

    static build(params: BuildParams): BuiltCar {
        const { gridData, startPos, side, root, prefabs, onCoreDie } = params;

        const result: BuiltCar = {
            partsMap: new Map(),
            coreHealth: null,
            coreNode: null,
            gunNodes: [],
            wheelJoints: [],
            weaponJoints: [],
            wheelMultipliers: new Map(),
            wheelAbilities: [],
            mouseCannons: [],
        };

        const groupName = side === "PLAYER" ? GROUP.PLAYER_PART : GROUP.BOT_PART;
        const sideMultiplier = side === "PLAYER" ? 1 : -1;

        // === 第一階段：生成零件、掛血量、紀錄槍械 ===
        for (const data of gridData) {
            const prefab = getPrefabByName(prefabs, data.partName);
            if (!prefab) continue;

            const node = cc.instantiate(prefab);
            node.parent = root;
            node.group = groupName;
            node.setPosition(
                startPos.x + data.gridX * GRID.CELL_SIZE * sideMultiplier,
                startPos.y + data.gridY * GRID.CELL_SIZE
            );
            node.scaleX = sideMultiplier;  // Bot 水平翻轉

            CarBuilder.inflateCollider(node);   // 碰撞體稍微外擴，讓車外緣接近實心、薄物件插不進凹口

            // 連續碰撞偵測（CCD）：高速移動時避免「穿進」障礙物 / 翹翹板後卡在裡面
            //（尤其 Bot 用純 Box2D，沒有玩家 AirPhysics 的掃掠保護）。
            const partRb = node.getComponent(cc.RigidBody);
            if (partRb) partRb.bullet = true;

            result.partsMap.set(`${data.gridX},${data.gridY}`, node);

            // 紀錄遠程武器節點。玩家的槍一律做成「跟隨滑鼠的砲塔」；BOT 的槍維持焊死直射。
            const drag = getDraggable(node);
            const hasMouseCannon = !!node.getComponent(MouseCannon);
            const isGun = !!drag && drag.partType === PartType.Weapon && drag.weaponMode === WeaponMode.Gun;
            const wantTurret = hasMouseCannon || (side === "PLAYER" && isGun);

            // 槍 / 砲塔（遠程武器）改成 sensor：只偵測傷害、不產生物理碰撞，
            // 讓槍管穿過敵車與地形、不把車推歪或卡住，砲塔瞄準也完全不受碰撞干擾。
            // 近戰武器維持實體碰撞（揮砍靠相對速度判傷）。
            if (isGun) {
                (node.getComponents(cc.PhysicsCollider) as cc.PhysicsCollider[]).forEach(c => {
                    c.sensor = true;
                    if ((c as any).apply) (c as any).apply();
                });
            }

            if (drag && drag.partType === PartType.Weapon) {
                cc.log(`[CarBuilder] ${side} 武器「${node.name}」 weaponMode=${drag.weaponMode} (0=Melee,1=Gun) MouseCannon=${hasMouseCannon} 砲塔=${wantTurret}`);
            }

            if (isGun && !wantTurret) {
                result.gunNodes.push(node);   // 只剩 BOT 一般槍
            }

            // 血量（沒有就補一個）
            const hp = node.getComponent(Health) || node.addComponent(Health);
            if (side === "BOT") {
                const roundBonus = (GameManager.playerWins + GameManager.botWins) * BATTLE.BOT_HP_BONUS_PER_ROUND;
                hp.maxHP += roundBonus;
                hp.currentHP = hp.maxHP;
            }

            const isCore = isCoreNode(node);
            if (isCore) {
                result.coreHealth = hp;
                result.coreNode = node;
            }

            // 收集特殊能力組件（用字串避免額外 import 耦合）
            const wheelAbility = node.getComponent("WheelAbility");
            if (wheelAbility) result.wheelAbilities.push(wheelAbility);

            // 生成音效（若有掛 PartAudio）
            const audio = node.getComponent("PartAudio") as any;
            if (audio && audio.playSpawn) audio.playSpawn();

            hp.onDieCallback = () => {
                CarBuilder.disjointPart(node);
                if (isCore) onCoreDie(side === "PLAYER" ? "BOT" : "PLAYER");
            };
        }

        // === 第二階段：依相鄰關係建立關節 ===
        result.partsMap.forEach((node, key) => {
            const coords = key.split(",").map(Number);
            const x = coords[0], y = coords[1];
            if (!getDraggable(node)) return;

            if (isBodyLikeNode(node)) {
                const right = result.partsMap.get(`${x + 1},${y}`);
                if (right && isBodyLikeNode(right)) JointFactory.weld(node, right);
                const top = result.partsMap.get(`${x},${y + 1}`);
                if (top && isBodyLikeNode(top)) JointFactory.weld(node, top);

                // 隱形星狀框：每個非核心 body 額外焊一條到核心 → 整車剛性大增、零件不被甩飛。
                // joint 掛在 node 上，零件死亡時會跟著銷毀。
                if (JOINT.STAR_WELD_TO_CORE && result.coreNode && node !== result.coreNode) {
                    JointFactory.weld(node, result.coreNode);
                }
            }

            if (isWheelNode(node)) {
                const r = JointFactory.createWheelJoint(node, result.partsMap, x, y);
                if (r) {
                    result.wheelJoints.push(r.joint);
                    result.wheelMultipliers.set(r.joint, r.multiplier);
                }
            } else if (isWeaponNode(node)) {
                const drag2 = getDraggable(node);
                const mc = node.getComponent(MouseCannon);
                const gun = !!drag2 && drag2.weaponMode === WeaponMode.Gun;
                const turret = !!mc || (side === "PLAYER" && gun);
                if (turret) {
                    const tj = JointFactory.createTurretJoint(node, result.partsMap, x, y, MOUSE_TURRET.TORQUE);
                    if (tj) {
                        // 弧度中心：建立當下砲管世界角 − 母體(關節所在 body)世界角
                        const c0 = node.convertToWorldSpaceAR(cc.v2(0, 0));
                        const fp0 = node.getChildByName("firepoint");
                        const m0 = fp0 ? fp0.convertToWorldSpaceAR(cc.v2(0, 0)) : node.convertToWorldSpaceAR(cc.v2(40, 0));
                        const barrel0 = Math.atan2(m0.y - c0.y, m0.x - c0.x) * 180 / Math.PI;
                        const mountOffset = barrel0 - (tj.node ? tj.node.angle : 0);
                        result.mouseCannons.push({ node, joint: tj, mountOffset });
                        CarBuilder.addAimLine(node);
                    }
                } else {
                    const j = JointFactory.createWeaponJoint(node, result.partsMap, x, y, side);
                    if (j) result.weaponJoints.push(j);
                }
            }
        });

        cc.log(`[CarBuilder] ${side} 完成：一般槍=${result.gunNodes.length}、近戰=${result.weaponJoints.length}、滑鼠砲=${result.mouseCannons.length}`);
        return result;
    }

    // 在砲塔武器上畫一條沿砲管方向的準星線（它是武器的子節點，會跟著武器一起轉，所以就是瞄準方向）
    private static addAimLine(gunNode: cc.Node) {
        if (gunNode.getChildByName("aimLine")) return;
        const fp = gunNode.getChildByName("firepoint");
        let dir = fp ? cc.v2(fp.x, fp.y) : cc.v2(40, 0);
        if (dir.mag() < 1) dir = cc.v2(40, 0);
        dir = dir.normalize();

        const lineNode = new cc.Node("aimLine");
        lineNode.parent = gunNode;
        lineNode.zIndex = 20;
        const g = lineNode.addComponent(cc.Graphics);
        g.lineWidth = 3;
        g.strokeColor = cc.color(255, 90, 90, 200);
        g.moveTo(dir.x * 12, dir.y * 12);
        g.lineTo(dir.x * 240, dir.y * 240);
        g.stroke();
    }

    // 把零件碰撞體稍微外擴，讓整車外緣接近連續實心、凹口變淺（薄碰撞體插不進輪子/方塊縫）。
    private static inflateCollider(node: cc.Node) {
        const inf = PHYSICS.COLLIDER_INFLATE;
        if (inf <= 0) return;
        const box = node.getComponent(cc.PhysicsBoxCollider);
        if (box) {
            box.size = cc.size(box.size.width + inf, box.size.height + inf);
            box.apply();
            return;
        }
        const circle = node.getComponent(cc.PhysicsCircleCollider);
        if (circle) {
            circle.radius += inf / 2;
            circle.apply();
        }
    }

    // 零件死亡 → 爆炸特效、斷開自身與連向自己的關節、改成 default 群組、給個向上彈的力，淡出後銷毀
    static disjointPart(node: cc.Node) {
        // 在零件原本位置炸一下（特效掛在父層，零件之後被銷毀也不影響）
        const parent = node.parent;
        if (parent) {
            const worldPos = node.convertToWorldSpaceAR(cc.v2(0, 0));
            const size = Math.max(node.width, node.height) || 60;
            Explosion.spawn(parent, worldPos, size);
            // 零件擊破：固定給一發強回饋（大震 + hitstop + 火花），讓「破壞」手感分明
            HitFeedback.trigger(HITFX.HITSTOP_DAMAGE, worldPos);
        }

        node.getComponents(cc.Joint).forEach(j => j.destroy());

        if (parent) {
            parent.getComponentsInChildren(cc.Joint).forEach(j => {
                if (j.connectedBody && j.connectedBody.node === node) j.destroy();
            });
        }

        node.group = GROUP.DEFAULT;

        // 爆炸後立刻消失，不做上拋、不做淡化。
        // 延遲一個極短時間再銷毀，是為了避開「在物理碰撞回呼當下直接 destroy」可能造成的 Box2D 崩潰。
        cc.tween(node)
            .delay(0.02)
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }
}