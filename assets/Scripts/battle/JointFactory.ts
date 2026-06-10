// battle/JointFactory.ts
// 原本 BattleManager 裡的 tryWeld / setupWheelJoint / setupWeaponJoint，
// 都是「給節點接物理關節」的純邏輯，跟戰鬥狀態無關，抽出來成為工廠。
//
// 與原版差異：不再自己 push 到陣列裡，而是把建立好的 joint 回傳給 CarBuilder 收集，
// 讓「建立關節」與「收集關節」職責分開。

import { isBodyLikeNode } from "../core/PartUtils";
import { JOINT } from "../core/GameConstants";
import { WeaponMode } from "../core/PartType";

export default class JointFactory {

    // 兩個車身焊死
    static weld(self: cc.Node, neighbor: cc.Node) {
        const selfRb = self.getComponent(cc.RigidBody);
        const neighborRb = neighbor.getComponent(cc.RigidBody);
        if (!selfRb || !neighborRb) return;

        const p1 = self.convertToWorldSpaceAR(cc.v2(0, 0));
        const p2 = neighbor.convertToWorldSpaceAR(cc.v2(0, 0));
        const jointWorld = cc.v2((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5);

        const joint = self.addComponent(cc.WeldJoint);
        joint.connectedBody = neighborRb;
        joint.anchor = self.convertToNodeSpaceAR(jointWorld);
        joint.connectedAnchor = neighbor.convertToNodeSpaceAR(jointWorld);
        joint.collideConnected = false;
        joint.frequency = JOINT.WELD_FREQUENCY;
    }

    // 輪子接到相鄰車身，回傳 joint 與速度倍率（找不到車身則回傳 null）
    static createWheelJoint(
        wheelNode: cc.Node,
        partMap: Map<string, cc.Node>,
        x: number,
        y: number
    ): { joint: cc.WheelJoint; multiplier: number } | null {

        let parentBox: cc.Node | null = null;
        let attachDir: "TOP" | "LEFT" | "RIGHT" | "BOTTOM" = "TOP";

        const neighbors = [
            { n: partMap.get(`${x},${y + 1}`), dir: "TOP" as const },
            { n: partMap.get(`${x - 1},${y}`), dir: "LEFT" as const },
            { n: partMap.get(`${x + 1},${y}`), dir: "RIGHT" as const },
            { n: partMap.get(`${x},${y - 1}`), dir: "BOTTOM" as const },
        ];

        for (const item of neighbors) {
            if (item.n && isBodyLikeNode(item.n)) {
                parentBox = item.n;
                attachDir = item.dir;
                break;
            }
        }
        if (!parentBox) return null;

        if (attachDir === "LEFT") wheelNode.angle = -90;
        else if (attachDir === "RIGHT") wheelNode.angle = 90;
        else if (attachDir === "BOTTOM") wheelNode.angle = 180;
        else wheelNode.angle = 0;

        const parentRb = parentBox.getComponent(cc.RigidBody);
        const wheelRb = wheelNode.getComponent(cc.RigidBody);
        if (!parentRb || !wheelRb) return null;

        // 抓地力：把輪子碰撞器摩擦力調高（預設 ~0.2 太滑，斜坡打滑）。Bounce 輪已改過 restitution，這裡只動 friction 不衝突。
        (wheelNode.getComponents(cc.PhysicsCollider) as cc.PhysicsCollider[]).forEach(c => {
            c.friction = JOINT.WHEEL_FRICTION;
            if ((c as any).apply) (c as any).apply();   // 已建立的 fixture 需 apply 才生效
        });

        const joint = parentBox.addComponent(cc.WheelJoint);
        joint.connectedBody = wheelRb;

        const worldPos = wheelNode.convertToWorldSpaceAR(cc.v2(0, 0));
        joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
        joint.connectedAnchor = wheelNode.convertToNodeSpaceAR(worldPos);
        joint.collideConnected = false;

        if (attachDir === "LEFT") joint.localAxisA = cc.v2(1, 0);
        else if (attachDir === "RIGHT") joint.localAxisA = cc.v2(-1, 0);
        else if (attachDir === "BOTTOM") joint.localAxisA = cc.v2(0, -1);
        else joint.localAxisA = cc.v2(0, 1);

        joint.frequency = JOINT.WHEEL_FREQUENCY;
        (joint as any).dampingRatio = JOINT.WHEEL_DAMPING;   // 臨界阻尼，懸吊硬且不來回彈 → 輪子貼著車身不「拆開」
        joint.enableMotor = true;

        const drag = wheelNode.getComponent("Draggable") as any;
        const multiplier =
            drag && typeof drag.wheelMotorMultiplier === "number" ? drag.wheelMotorMultiplier : 1;
        joint.maxMotorTorque = JOINT.WHEEL_MAX_TORQUE * multiplier;

        return { joint, multiplier };
    }

    // 武器接到相鄰車身。
    // 遠程（Gun）→ 用 WeldJoint 固定，回傳 null（不需要被收進近戰陣列）。
    // 近戰（Melee）→ 用 RevoluteJoint 可旋轉，回傳該 joint 給上層收集。
    static createWeaponJoint(
        weaponNode: cc.Node,
        partMap: Map<string, cc.Node>,
        x: number,
        y: number,
        side: "PLAYER" | "BOT"
    ): cc.RevoluteJoint | null {

        let parentBox: cc.Node | null = null;
        const coords = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const c of coords) {
            const n = partMap.get(`${c[0]},${c[1]}`);
            if (n && isBodyLikeNode(n)) { parentBox = n; break; }
        }
        if (!parentBox) return null;

        const parentRb = parentBox.getComponent(cc.RigidBody);
        const weaponRb = weaponNode.getComponent(cc.RigidBody);
        if (!parentRb || !weaponRb) return null;

        const drag = weaponNode.getComponent("Draggable") as any;
        const worldPos = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));

        if (drag && drag.weaponMode === WeaponMode.Gun) {
            const joint = parentBox.addComponent(cc.WeldJoint);
            joint.connectedBody = weaponRb;
            joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
            joint.connectedAnchor = weaponNode.convertToNodeSpaceAR(worldPos);
            return null;
        }

        const joint = parentBox.addComponent(cc.RevoluteJoint);
        joint.connectedBody = weaponRb;
        joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
        joint.connectedAnchor = weaponNode.convertToNodeSpaceAR(worldPos);
        joint.enableLimit = true;
        joint.lowerAngle = side === "PLAYER" ? JOINT.PLAYER_LOWER_ANGLE : JOINT.BOT_LOWER_ANGLE;
        joint.upperAngle = side === "PLAYER" ? JOINT.PLAYER_UPPER_ANGLE : JOINT.BOT_UPPER_ANGLE;
        joint.enableMotor = true;
        joint.maxMotorTorque = JOINT.MELEE_MAX_TORQUE;
        return joint;
    }

    // 旋轉砲塔關節（滑鼠砲用）：可 360° 自由旋轉瞄準（不限制角度）。
    static createTurretJoint(
        weaponNode: cc.Node,
        partMap: Map<string, cc.Node>,
        x: number,
        y: number,
        torque: number
    ): cc.RevoluteJoint | null {

        let parentBox: cc.Node | null = null;
        const coords = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const c of coords) {
            const n = partMap.get(`${c[0]},${c[1]}`);
            if (n && isBodyLikeNode(n)) { parentBox = n; break; }
        }
        if (!parentBox) return null;

        const parentRb = parentBox.getComponent(cc.RigidBody);
        const weaponRb = weaponNode.getComponent(cc.RigidBody);
        if (!parentRb || !weaponRb) return null;

        const worldPos = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        const joint = parentBox.addComponent(cc.RevoluteJoint);
        joint.connectedBody = weaponRb;
        joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
        joint.connectedAnchor = weaponNode.convertToNodeSpaceAR(worldPos);
        // 不限制旋轉角度 → 砲塔可 360° 自由瞄準（瞄準由 BattleManager.aimTurret 直接設角度）。
        joint.enableLimit = false;
        // 不用馬達瞄準（馬達會把反作用扭矩帶到車身讓整台車轉）。改由 BattleManager.aimTurret 直接設角速度。
        joint.enableMotor = false;
        joint.maxMotorTorque = torque;
        return joint;
    }
}