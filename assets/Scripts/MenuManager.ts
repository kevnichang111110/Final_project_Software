import GameManager from "./GameManager";
import FirebaseService from "./net/FirebaseService";
const { ccclass, property } = cc._decorator;

@ccclass
export default class MenuManager extends cc.Component {

    // 如果你有做 Setting 的 Prefab，可以拖到這裡，但我們先做基本跳轉
    @property(cc.Prefab)
    settingsPrefab: cc.Prefab|null = null;

    @property(cc.AudioClip)
    bgmClip: cc.AudioClip |null= null;

    @property({ type: cc.Node, tooltip: "排行榜彈窗面板" })
    leaderboardPanel: cc.Node = null;

    @property({ type: cc.Node, tooltip: "個人檔案彈窗面板" })
    ProfilePanel: cc.Node = null;

    private bgmAudioID: number = -1;
    onLoad() {
        
        cc.audioEngine.setMusicVolume(GameManager.bgmVolume);
        cc.audioEngine.setEffectsVolume(GameManager.sfxVolume);
        if (this.bgmClip) {
            this.bgmAudioID = cc.audioEngine.playMusic(this.bgmClip, true);
        }
    }


    onPlayButtonClick() {
        cc.director.loadScene("SelectMode");
    }

   onLeaderboardButtonClick() {
        if (this.leaderboardPanel) {
            this.leaderboardPanel.active = true; // 顯示排行榜
        } else {
            cc.error("尚未在編輯器中關聯 Leaderboard Panel！");
        }
    }
    onProfileButtonClick() {
        if (this.ProfilePanel) {
            this.ProfilePanel.active = true; // 顯示排行榜
        } else {
            cc.error("尚未在編輯器中關聯profileboard Panel！");
        }
    }
    Singleplayer() {
        GameManager.resetAllData();
        cc.director.loadScene("Shop");
    }
    Multiplayer() {
        GameManager.resetAllData();
        cc.director.loadScene("Shop");
    }
    onOpenSettings() {
        if (this.settingsPrefab) {
            let settingsNode = cc.instantiate(this.settingsPrefab);
            let canvas = cc.find("Canvas");
            settingsNode.parent = canvas;
            settingsNode.setSiblingIndex(canvas.childrenCount - 1);
            settingsNode.setPosition(0, 0);
        } else {
            console.error("尚未在編輯器中關聯 Settings Prefab！");
        }
    }
    addTestWin() {
    // 呼叫 FirebaseService 裡的勝場增加功能
    FirebaseService.incrementWins().then(() => {
        cc.log("勝場加 1 成功！");
    });
}

}