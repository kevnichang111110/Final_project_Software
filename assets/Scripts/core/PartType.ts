// core/PartType.ts
// 零件相關的列舉統一放這裡（原本分散在 Slotsetting.ts 與 Draggable.ts）。
//
// ⚠ 重要：PartType 的數值有跳號（Body=0, Weapon=1, Core=4, Wheel=5），
// 這是為了相容編輯器裡「已經存好」的下拉選項（以整數儲存）。
// 請勿更動既有數值，否則所有 prefab / 場景上的選擇都會跑掉。

export enum PartType {
    Body = 0,
    Weapon = 1,
    Core = 4,
    Wheel = 5,
}

export enum WeaponMode {
    Melee = 0,
    Gun = 1,
}

// 註冊給編輯器下拉選單使用（原本在各組件內呼叫，統一移到這裡）
cc.Enum(PartType);
cc.Enum(WeaponMode);
