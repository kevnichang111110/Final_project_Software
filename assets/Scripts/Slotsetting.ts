// Slotsetting.ts
// 變更：PartType 移到 core/PartType 統一管理；這裡 import 後 re-export，
//       讓任何「from "./Slotsetting" import { PartType }」的舊程式（例如 ShopManager）仍可運作。
//       PartSlot 組件本身不變（檔名/類別名不變，編輯器綁定不受影響）。

import { PartType } from "./core/PartType";
export { PartType };

const { ccclass, property } = cc._decorator;

@ccclass
export default class PartSlot extends cc.Component {
    @property({ type: cc.Enum(PartType) })
    slotType = PartType.Wheel;

    public isOccupied: boolean = false;
}
