// battle/BotAI.ts
// 原本 BattleManager.updateBotAI。負責 Bot 的移動（追/退）、近戰揮砍、遠程射擊。
// 在 spawnBotSequence 建好 Bot 車後，用 BuiltCar 的 joint 資料 new 一個出來。

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

    constructor(car: BuiltCar, gunFireInterval: number) {
        this.wheelJoints = car.wheelJoints;
        this.weaponJoints = car.weaponJoints;
        this.wheelMultipliers = car.wheelMultipliers;
        this.gunNodes = car.gunNodes;
        this.gunFireInterval = gunFireInterval;
    }

    update(dt: number, playerRoot: cc.Node, botRoot: cc.Node, weapons: WeaponSystem) {
        if (!playerRoot || !botRoot) return;

        const distance = playerRoot.x - botRoot.x;
        const absDist = Math.abs(distance);

        // 移動：太遠就追、太近就退
        let moveDir = 0;
        if (absDist > BOT.CHASE_DIST) moveDir = distance > 0 ? 1 : -1;
        else if (absDist < BOT.RETREAT_DIST) moveDir = distance > 0 ? -1 : 1;

        this.wheelJoints.forEach(j => {
            const mul = this.wheelMultipliers.get(j) ?? 1;
            j.motorSpeed = BOT.MOVE_SPEED * moveDir * mul;
        });

        // 近戰：進入攻擊距離就來回揮，否則收回
        for (const j of this.weaponJoints) {
            const cur = j.getJointAngle();
            if (absDist < BOT.ATTACK_RANGE) {
                if (cur <= j.lowerAngle) j.motorSpeed = BOT.ATTACK_SPEED;
                else if (cur >= j.upperAngle) j.motorSpeed = -BOT.ATTACK_SPEED;
                if (j.motorSpeed === 0) j.motorSpeed = BOT.ATTACK_SPEED;
            } else {
                if (cur > j.lowerAngle) j.motorSpeed = BOT.RETURN_SPEED;
            }
        }

        // 遠程：冷卻到了就齊射
        this.gunCooldown = Math.max(0, this.gunCooldown - dt);
        if (this.gunNodes.length > 0 && this.gunCooldown <= 0) {
            for (const gunNode of this.gunNodes) weapons.fireFrom(gunNode, "BOT");
            this.gunCooldown = this.gunFireInterval;
        }
    }
}
