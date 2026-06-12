import FirebaseService from "./FirebaseService";

const { ccclass, property } = cc._decorator;
declare const firebase: any;

@ccclass
export default class ProfileManager extends cc.Component {
    
    @property(cc.Label) emailLabel: cc.Label = null;
    @property(cc.Label) winsLabel: cc.Label = null;
    @property(cc.Label) scoreLabel: cc.Label = null;
    
    // 【新增】編輯框與頭像圖片
    @property(cc.EditBox) nameInput: cc.EditBox = null;
    @property(cc.Sprite) avatarSprite: cc.Sprite = null;
    
    // 【新增】把 8 張頭像拖曳到這個陣列裡
    @property([cc.SpriteFrame]) avatarFrames: cc.SpriteFrame[] = [];

    private currentAvatarId: number = 0;

    onEnable() {
        this.loadProfile();
    }

    loadProfile() {
        const user = FirebaseService.getUser();
        if (!user) return;

        if (this.emailLabel) this.emailLabel.string = `Mail：${user.email}`;

        const projectId = "ssdfinal-c6446"; 
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.uid}`;

       fetch(url)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && data.fields) {
                    const name = data.fields.name ? data.fields.name.stringValue : "未命名玩家";
                    this.currentAvatarId = data.fields.avatarId && data.fields.avatarId.integerValue ? parseInt(data.fields.avatarId.integerValue) : 0;

                    // 1. 抓取新欄位
                    const winRate = data.fields.winRate ? parseFloat(data.fields.winRate.doubleValue || data.fields.winRate.integerValue || "0") : 0;
                    const currentStreak = data.fields.currentStreak && data.fields.currentStreak.integerValue ? parseInt(data.fields.currentStreak.integerValue) : 0;
                    const maxStreak = data.fields.maxStreak && data.fields.maxStreak.integerValue ? parseInt(data.fields.maxStreak.integerValue) : 0;
                    const wins = data.fields.wins && data.fields.wins.integerValue ? parseInt(data.fields.wins.integerValue) : 0;
                    const totalGames = data.fields.totalGames && data.fields.totalGames.integerValue ? parseInt(data.fields.totalGames.integerValue) : 0;

                    // 2. 更新到 UI (欄位變數名可根據你編輯器的 Label 自由調整)
                    if (this.nameInput) this.nameInput.string = name;
                    
                    // 顯示例如：勝率：75.5% (4勝/5局)
                    if (this.winsLabel) this.winsLabel.string = `勝率：${winRate}% (${wins}勝/${totalGames}局)`;
                    
                    // 顯示例如：連勝：3 (最高：7)
                    if (this.scoreLabel) this.scoreLabel.string = `當前連勝：${currentStreak} (最高：${maxStreak})`;
                    
                    this.updateAvatarDisplay();
                }
            });
    }

    // 切換上一張頭像 (綁定給 < 按鈕)
    onPrevAvatar() {
        this.currentAvatarId--;
        if (this.currentAvatarId < 0) this.currentAvatarId = this.avatarFrames.length - 1;
        this.updateAvatarDisplay();
    }

    // 切換下一張頭像 (綁定給 > 按鈕)
    onNextAvatar() {
        this.currentAvatarId++;
        if (this.currentAvatarId >= this.avatarFrames.length) this.currentAvatarId = 0;
        this.updateAvatarDisplay();
    }

    private updateAvatarDisplay() {
        if (this.avatarSprite && this.avatarFrames.length > 0) {
            this.avatarSprite.spriteFrame = this.avatarFrames[this.currentAvatarId];
        }
    }

    // 儲存按鈕事件
    onSaveProfile() {
        const user = FirebaseService.getUser();
        if (!user) {
            cc.warn("尚未登入，無法儲存");
            return;
        }

        const newName = this.nameInput ? this.nameInput.string : "未命名玩家";
        const projectId = "ssdfinal-c6446"; 
        
        // 使用 PATCH 更新指定欄位 (name, avatarId)
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.uid}?updateMask.fieldPaths=name&updateMask.fieldPaths=avatarId`;

        fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    name: { stringValue: newName },
                    avatarId: { integerValue: this.currentAvatarId }
                }
            })
        })
        .then(res => {
            if (!res.ok) throw new Error("寫入失敗，狀態碼：" + res.status);
            return res.json();
        })
        .then(data => {
            cc.log("資料更新成功！");
            // 你可以在這裡加入一個「儲存成功」的 UI 提示
        })
        .catch(err => {
            cc.error("資料更新失敗：", err);
        });
    }

    onCloseButtonClick() {
        this.node.active = false;
    }
}