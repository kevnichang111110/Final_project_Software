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
                    const name = data.fields.name ? data.fields.name.stringValue : "Unknown";
                    
                    let wins = data.fields.wins && data.fields.wins.integerValue ? parseInt(data.fields.wins.integerValue) : 0;
                    let bestScore = data.fields.bestScore && data.fields.bestScore.integerValue ? parseInt(data.fields.bestScore.integerValue) : 0;
                    
                    // 讀取頭像編號 (預設 0)
                    this.currentAvatarId = data.fields.avatarId && data.fields.avatarId.integerValue ? parseInt(data.fields.avatarId.integerValue) : 0;

                    if (this.nameInput) this.nameInput.string = name;
                    if (this.winsLabel) this.winsLabel.string = `Win：${wins}`;
                    if (this.scoreLabel) this.scoreLabel.string = `High Score：${bestScore}`;
                    
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
        if (!user) return;

        const newName = this.nameInput ? this.nameInput.string : "未命名玩家";
        
        // 寫入資料通常不會被防火牆擋，我們直接用官方 SDK 寫入最方便
        firebase.firestore().collection("users").doc(user.uid).set({
            name: newName,
            avatarId: this.currentAvatarId
        }, { merge: true })
        .then(() => {
            cc.log("資料更新成功！");
            // 可在此處加入一個「儲存成功」的提示文字
        })
        .catch(err => {
            cc.error("資料更新失敗：", err);
        });
    }

    onCloseButtonClick() {
        this.node.active = false;
    }
}