// core/PartUtils.ts
// 原本 cleanName / isCoreNode / isBodyLikeNode / getPrefabByName 這些判斷
// 在 BattleManager、ShopManager、Draggable 各自重寫了一份，這裡統一。
//
// Draggable 一律用字串 getComponent("Draggable") 取得，避免引入循環依賴，
// 也跟原本 HealthManager 的寫法一致。

import { PartType } from "./PartType";

// 去掉節點名稱裡的 (Clone)/(數字) 並轉小寫
export function cleanName(name: string): string {
    return name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
}

// 取得節點上的 Draggable（回傳 any 方便讀 partType / weaponMode / wheelMotorMultiplier）
export function getDraggable(node: cc.Node): any {
    return node.getComponent("Draggable");
}

export function isCoreNode(node: cc.Node): boolean {
    const drag = getDraggable(node);
    return (drag && drag.partType === PartType.Core) || cleanName(node.name) === "core";
}

export function isBodyLikeNode(node: cc.Node): boolean {
    const drag = getDraggable(node);
    return !!drag && (drag.partType === PartType.Body || drag.partType === PartType.Core || isCoreNode(node));
}

export function isWheelNode(node: cc.Node): boolean {
    const drag = getDraggable(node);
    return !!drag && drag.partType === PartType.Wheel;
}

export function isWeaponNode(node: cc.Node): boolean {
    const drag = getDraggable(node);
    return !!drag && drag.partType === PartType.Weapon;
}

// 從 prefab 陣列裡用名字找（忽略大小寫與 (Clone)）
export function getPrefabByName(prefabs: cc.Prefab[], name: string): cc.Prefab | undefined {
    const clean = cleanName(name);
    return prefabs.find(p => p && p.name.trim().toLowerCase() === clean);
}
