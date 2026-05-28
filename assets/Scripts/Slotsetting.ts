const {ccclass, property} = cc._decorator;

export enum PartType {
    Wheel = 0,
    Body = 1,
    Weapon = 2
}

@ccclass
export default class PartSlot extends cc.Component {
    @property({ type: cc.Enum(PartType) }) 
    slotType = PartType.Wheel; 

    public isOccupied: boolean = false; 
}