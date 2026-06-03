// battle/CarBuilder.ts
// 原本 BattleManager.spawnGridCar + handlePartDisjoint。
// 負責「依網格資料把一台車生出來、掛血量、接好所有關節」，
// 並把建立結果（核心血量、槍械、各種 joint）打包回傳，讓 BattleManager / BotAI 使用。

import GameManager from "../GameManager";
import { GROUP, BATTLE, GRID } from "../core/GameConstants";
import { PartType, WeaponMode } from "../core/PartType";
import {
    isCoreNode, isBodyLikeNode, isWheelNode, isWeaponNode, getPrefabByName, getDraggable,
} from "../core/PartUtils";
import JointFactory from "./JointFactory";
import Health from "../HealthManager";

// 一台車建好後對外提供的資料
export interface BuiltCar {
    partsMap: Map<string, cc.Node>;
    coreHealth: Health | null;
    gunNodes: cc.Node[];
    wheelJoints: cc.WheelJoint[];
    weaponJoints: cc.RevoluteJoint[];
    wheelMultipliers: Map<cc.WheelJoint, number>;
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
            gunNodes: [],
            wheelJoints: [],
            weaponJoints: [],
            wheelMultipliers: new Map(),
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

            result.partsMap.set(`${data.gridX},${data.gridY}`, node);

            // 紀錄遠程武器節點，之後 WeaponSystem 用它開火
            const drag = getDraggable(node);
            if (drag && drag.partType === PartType.Weapon && drag.weaponMode === WeaponMode.Gun) {
                result.gunNodes.push(node);
            }

            // 血量（沒有就補一個）
            const hp = node.getComponent(Health) || node.addComponent(Health);
            if (side === "BOT") {
                const roundBonus = (GameManager.playerWins + GameManager.botWins) * BATTLE.BOT_HP_BONUS_PER_ROUND;
                hp.maxHP += roundBonus;
                hp.currentHP = hp.maxHP;
            }

            const isCore = isCoreNode(node);
            if (isCore) result.coreHealth = hp;

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
            }

            if (isWheelNode(node)) {
                const r = JointFactory.createWheelJoint(node, result.partsMap, x, y);
                if (r) {
                    result.wheelJoints.push(r.joint);
                    result.wheelMultipliers.set(r.joint, r.multiplier);
                }
            } else if (isWeaponNode(node)) {
                const j = JointFactory.createWeaponJoint(node, result.partsMap, x, y, side);
                if (j) result.weaponJoints.push(j);
            }
        });

        return result;
    }

    // 零件死亡 → 斷開自身與連向自己的關節、改成 default 群組、給個向上彈的力，淡出後銷毀
    static disjointPart(node: cc.Node) {
        node.getComponents(cc.Joint).forEach(j => j.destroy());

        const parent = node.parent;
        if (parent) {
            parent.getComponentsInChildren(cc.Joint).forEach(j => {
                if (j.connectedBody && j.connectedBody.node === node) j.destroy();
            });
        }

        node.group = GROUP.DEFAULT;
        const rb = node.getComponent(cc.RigidBody);
        if (rb) rb.applyForceToCenter(cc.v2(0, 1000), true);

        cc.tween(node)
            .delay(1.5)
            .to(0.5, { opacity: 0 })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }
}
