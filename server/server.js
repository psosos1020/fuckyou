const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, '../')));
app.use(express.json());

// 루트 요청이 들어오면 꼬rpg.html 반환 (기본 index.html이 아닌 경우 대비)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../', '꼬rpg.html'));
});

// 게임 상태 관리
const gameState = {
  players: new Map(),
  mobs: new Map(),
  items: new Map(),
  guilds: new Map(),
  trades: new Map(),
  pvpBattles: new Map()
};

// 아이템 데이터
const itemDatabase = {
  weapon: [
    { id: 'iron_sword', name: '철검', dmg: 10, price: 100, enhance: 0 },
    { id: 'steel_sword', name: '강철검', dmg: 20, price: 500, enhance: 0 },
    { id: 'gold_sword', name: '황금검', dmg: 50, price: 2000, enhance: 0 }
  ],
  armor: [
    { id: 'leather_armor', name: '가죽갑옷', def: 5, price: 80, enhance: 0 },
    { id: 'iron_armor', name: '철갑옷', def: 15, price: 400, enhance: 0 },
    { id: 'steel_armor', name: '강철갑옷', def: 30, price: 1500, enhance: 0 }
  ],
  consumable: [
    { id: 'hp_potion', name: '체력 포션', heal: 50, price: 20 },
    { id: 'mp_potion', name: '마나 포션', heal: 30, price: 15 },
    { id: 'all_potion', name: '만능 포션', heal: 100, price: 50 }
  ]
};

// 스킬 데이터
const skillDatabase = {
  warrior: [
    { id: 'slash', name: '슬래시', dmg: 1.2, mp: 10, level: 1 },
    { id: 'power_slash', name: '파워 슬래시', dmg: 1.8, mp: 20, level: 10 },
    { id: 'whirlwind', name: '회오리 바람', dmg: 2.5, mp: 40, level: 30 }
  ],
  mage: [
    { id: 'fireball', name: '파이어볼', dmg: 1.3, mp: 15, level: 1 },
    { id: 'ice_spear', name: '얼음 창', dmg: 1.6, mp: 25, level: 10 },
    { id: 'meteor', name: '메테오', dmg: 3.0, mp: 50, level: 30 }
  ]
};

// 몹 데이터베이스
const mobDatabase = [
  { id: 'slime', name: '슬라임', hp: 10, exp: 50, dropRate: 0.3, dmg: 2 },
  { id: 'zombie', name: '좀비', hp: 30, exp: 100, dropRate: 0.4, dmg: 5 },
  { id: 'goblin', name: '고블린', hp: 50, exp: 150, dropRate: 0.5, dmg: 8 },
  { id: 'orc', name: '오크', hp: 80, exp: 250, dropRate: 0.6, dmg: 12 },
  { id: 'boss_dragon', name: '드래곤(보스)', hp: 500, exp: 1000, dropRate: 0.9, dmg: 20 }
];

// 초기 몹 생성
function initializeMobs() {
  const regularMobs = mobDatabase.filter(m => m.id !== 'boss_dragon');
  
  for (let i = 0; i < 30; i++) {
    const mobType = regularMobs[Math.floor(Math.random() * regularMobs.length)];
    gameState.mobs.set(uuidv4(), {
      type: mobType.id,
      name: mobType.name,
      hp: mobType.hp,
      maxHp: mobType.hp,
      x: Math.random() * 1200,
      y: Math.random() * 800,
      exp: mobType.exp,
      dropRate: mobType.dropRate,
      dmg: mobType.dmg,
      lastAttack: 0
    });
  }
  
  // 보스 몹 생성
  gameState.mobs.set('boss_dragon', {
    type: 'boss_dragon',
    name: '드래곤(보스)',
    hp: 500,
    maxHp: 500,
    x: 600,
    y: 400,
    exp: 1000,
    dropRate: 0.9,
    dmg: 20,
    lastAttack: 0
  });
}

// 직업 시스템
const jobClasses = {
  warrior: { name: '전사', str: 15, dex: 10, int: 5, vit: 15 },
  mage: { name: '마법사', str: 5, dex: 10, int: 20, vit: 10 },
  archer: { name: '궁수', str: 10, dex: 18, int: 10, vit: 12 }
};

// 플레이어 정보
class Player {
  constructor(id, nickname, job = 'warrior') {
    this.id = id;
    this.nickname = nickname;
    this.job = job;
    this.level = 1;
    this.exp = 0;
    this.expToLevelUp = 100;
    this.hp = 100;
    this.maxHp = 100;
    this.mp = 50;
    this.maxMp = 50;
    this.x = 400;
    this.y = 300;
    this.stats = {
      str: jobClasses[job].str,
      dex: jobClasses[job].dex,
      int: jobClasses[job].int,
      vit: jobClasses[job].vit
    };
    this.skills = [];
    this.learnedSkills(job);
    this.inventory = [];
    this.equipment = {
      weapon: null,
      armor: null,
      accessory: null
    };
    this.meso = 5000;
    this.enhance = 0;
    this.guild = null;
    this.pvpWins = 0;
    this.pvpLosses = 0;
  }

  learnedSkills(job) {
    if (skillDatabase[job]) {
      this.skills = skillDatabase[job].filter(s => s.level <= this.level).map(s => ({ ...s }));
    }
  }

  addExp(amount) {
    this.exp += amount;
    if (this.exp >= this.expToLevelUp) {
      this.levelUp();
    }
  }

  levelUp() {
    this.level++;
    this.exp -= this.expToLevelUp;
    this.expToLevelUp = Math.floor(this.expToLevelUp * 1.1);
    this.maxHp += 20;
    this.hp = this.maxHp;
    this.maxMp += 10;
    this.mp = this.maxMp;
    this.stats.str += 3;
    this.stats.dex += 3;
    this.stats.int += 3;
    this.stats.vit += 2;
    this.learnedSkills(this.job);
  }

  getAttackDamage() {
    const baseDamage = this.stats.str + (this.equipment.weapon?.dmg || 0);
    return Math.floor(baseDamage * (0.8 + Math.random() * 0.4));
  }

  getDefense() {
    return (this.equipment.armor?.def || 0) + this.stats.vit;
  }
}

// WebSocket 연결 처리
wss.on('connection', (ws) => {
  console.log('새 클라이언트 연결됨');
  let playerId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(ws, data);
    } catch (e) {
      console.error('메시지 파싱 오류:', e);
    }
  });

  ws.on('close', () => {
    if (playerId && gameState.players.has(playerId)) {
      gameState.players.delete(playerId);
      broadcastGameState();
      console.log('플레이어 연결 해제:', playerId);
    }
  });

  function handleMessage(ws, data) {
    switch (data.type) {
      case 'join':
        playerId = uuidv4();
        gameState.players.set(playerId, new Player(playerId, data.nickname, data.job || 'warrior'));
        ws.send(JSON.stringify({
          type: 'joined',
          playerId: playerId,
          player: gameState.players.get(playerId)
        }));
        broadcastGameState();
        break;

      case 'move':
        if (gameState.players.has(playerId)) {
          const player = gameState.players.get(playerId);
          player.x = Math.max(0, Math.min(data.x, 1400));
          player.y = Math.max(0, Math.min(data.y, 800));
          broadcastGameState();
        }
        break;

      case 'attack':
        if (gameState.players.has(playerId) && gameState.mobs.has(data.mobId)) {
          const player = gameState.players.get(playerId);
          const mob = gameState.mobs.get(data.mobId);
          const damage = Math.max(1, player.getAttackDamage() - Math.floor(Math.random() * 5));
          mob.hp -= damage;
          // 모든 클라이언트에게 공격 이펙트 전송
          const effectMsg = JSON.stringify({
            type: 'effect',
            effect: 'hit',
            x: mob.x,
            y: mob.y,
            mobId: data.mobId,
            attackerId: playerId,
            damage
          });
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(effectMsg);
          });

          if (mob.hp <= 0) {
            player.addExp(mob.exp);
            gameState.mobs.delete(data.mobId);
            player.meso += Math.floor(mob.exp * 0.5);
            
            if (Math.random() < mob.dropRate) {
              const itemType = Object.keys(itemDatabase)[Math.floor(Math.random() * Object.keys(itemDatabase).length)];
              const items = itemDatabase[itemType];
              const item = items[Math.floor(Math.random() * items.length)];
              player.inventory.push({
                id: uuidv4(),
                name: item.name,
                type: itemType,
                enhance: item.enhance || 0,
                dmg: item.dmg,
                def: item.def,
                price: item.price
              });
            }
            
            // 새로운 몹 생성
            const mobType = mobDatabase.filter(m => m.id !== 'boss_dragon')[Math.floor(Math.random() * (mobDatabase.length - 1))];
            gameState.mobs.set(uuidv4(), {
              type: mobType.id,
              name: mobType.name,
              hp: mobType.hp,
              maxHp: mobType.hp,
              x: Math.random() * 1200,
              y: Math.random() * 800,
              exp: mobType.exp,
              dropRate: mobType.dropRate,
              dmg: mobType.dmg,
              lastAttack: 0
            });
          }
          broadcastGameState();
        }
        break;

      case 'useSkill':
        if (gameState.players.has(playerId)) {
          const player = gameState.players.get(playerId);
          const skill = player.skills.find(s => s.id === data.skillId);
          
          if (skill && player.mp >= skill.mp) {
            player.mp -= skill.mp;
            if (gameState.mobs.has(data.targetId)) {
              const mob = gameState.mobs.get(data.targetId);
              const damage = Math.floor(skill.dmg * player.getAttackDamage());
              mob.hp -= damage;
              
              if (mob.hp <= 0) {
                player.addExp(mob.exp);
                gameState.mobs.delete(data.targetId);
                player.meso += Math.floor(mob.exp * 0.5);
              }
            }
            broadcastGameState();
          }
        }
        break;

      case 'buyItem':
        if (gameState.players.has(playerId)) {
          const player = gameState.players.get(playerId);
          const itemType = data.itemType;
          const itemIndex = data.itemIndex;
          
          if (itemDatabase[itemType] && itemDatabase[itemType][itemIndex]) {
            const item = itemDatabase[itemType][itemIndex];
            if (player.meso >= item.price) {
              player.meso -= item.price;
              player.inventory.push({
                id: uuidv4(),
                name: item.name,
                type: itemType,
                enhance: 0,
                dmg: item.dmg,
                def: item.def,
                price: item.price
              });
              broadcastGameState();
            }
          }
        }
        break;

      case 'equipItem':
        if (gameState.players.has(playerId)) {
          const player = gameState.players.get(playerId);
          const item = player.inventory.find(i => i.id === data.itemId);
          
          if (item) {
            if (item.type === 'weapon') {
              player.equipment.weapon = item;
              player.inventory = player.inventory.filter(i => i.id !== data.itemId);
            } else if (item.type === 'armor') {
              player.equipment.armor = item;
              player.inventory = player.inventory.filter(i => i.id !== data.itemId);
            }
            broadcastGameState();
          }
        }
        break;

      case 'unequipItem':
        if (gameState.players.has(playerId)) {
          const player = gameState.players.get(playerId);
          const slot = data.slot;
          
          if (player.equipment[slot]) {
            player.inventory.push(player.equipment[slot]);
            player.equipment[slot] = null;
            broadcastGameState();
          }
        }
        break;

      case 'enhance':
        if (gameState.players.has(playerId)) {
          const player = gameState.players.get(playerId);
          const item = player.inventory.find(i => i.id === data.itemId);
          
          if (item && item.type === 'weapon' && player.meso >= 200 * (item.enhance + 1)) {
            player.meso -= 200 * (item.enhance + 1);
            const successRate = Math.max(10, 95 - item.enhance * 8);
            
            if (Math.random() * 100 < successRate) {
              item.enhance++;
              item.dmg = Math.floor(item.dmg * 1.2);
            } else {
              if (item.enhance > 0) item.enhance = Math.max(0, item.enhance - 1);
            }
            broadcastGameState();
          }
        }
        break;

      case 'requestTrade':
        if (gameState.players.has(playerId) && gameState.players.has(data.targetId)) {
          const tradeId = uuidv4();
          gameState.trades.set(tradeId, {
            id: tradeId,
            player1: playerId,
            player2: data.targetId,
            items1: [],
            items2: [],
            meso1: 0,
            meso2: 0,
            confirmed1: false,
            confirmed2: false
          });
          
          ws.send(JSON.stringify({
            type: 'tradeRequest',
            tradeId: tradeId,
            targetNickname: gameState.players.get(data.targetId).nickname
          }));
        }
        break;

      case 'addToTrade':
        if (gameState.trades.has(data.tradeId)) {
          const trade = gameState.trades.get(data.tradeId);
          const isPlayer1 = playerId === trade.player1;
          
          if (data.itemId) {
            const item = gameState.players.get(playerId).inventory.find(i => i.id === data.itemId);
            if (item) {
              if (isPlayer1) trade.items1.push(item);
              else trade.items2.push(item);
            }
          } else if (data.meso) {
            if (isPlayer1) trade.meso1 += data.meso;
            else trade.meso2 += data.meso;
          }
          broadcastGameState();
        }
        break;

      case 'confirmTrade':
        if (gameState.trades.has(data.tradeId)) {
          const trade = gameState.trades.get(data.tradeId);
          const isPlayer1 = playerId === trade.player1;
          
          if (isPlayer1) trade.confirmed1 = true;
          else trade.confirmed2 = true;
          
          if (trade.confirmed1 && trade.confirmed2) {
            const player1 = gameState.players.get(trade.player1);
            const player2 = gameState.players.get(trade.player2);
            
            player1.inventory = player1.inventory.filter(i => !trade.items1.includes(i));
            player2.inventory = player2.inventory.filter(i => !trade.items2.includes(i));
            
            player1.inventory.push(...trade.items2);
            player2.inventory.push(...trade.items1);
            
            player1.meso -= trade.meso1;
            player1.meso += trade.meso2;
            player2.meso -= trade.meso2;
            player2.meso += trade.meso1;
            
            gameState.trades.delete(data.tradeId);
            broadcastGameState();
          }
        }
        break;

      case 'pvpRequest':
        if (gameState.players.has(data.targetId)) {
          const battleId = uuidv4();
          gameState.pvpBattles.set(battleId, {
            id: battleId,
            player1: playerId,
            player2: data.targetId,
            turn: 0
          });
          
          ws.send(JSON.stringify({
            type: 'pvpChallenge',
            battleId: battleId,
            challenger: gameState.players.get(playerId).nickname
          }));
        }
        break;

      case 'acceptPVP':
        if (gameState.pvpBattles.has(data.battleId)) {
          const battle = gameState.pvpBattles.get(data.battleId);
          battle.turn = 1;
          broadcastGameState();
        }
        break;

      case 'pvpAttack':
        if (gameState.pvpBattles.has(data.battleId)) {
          const battle = gameState.pvpBattles.get(data.battleId);
          const isPlayer1 = playerId === battle.player1;
          const attacker = gameState.players.get(isPlayer1 ? battle.player1 : battle.player2);
          const defender = gameState.players.get(isPlayer1 ? battle.player2 : battle.player1);
          
          const damage = Math.max(1, attacker.getAttackDamage() - Math.floor(defender.getDefense() / 2));
          defender.hp -= damage;
          
          if (defender.hp <= 0) {
            attacker.pvpWins++;
            defender.pvpLosses++;
            attacker.meso += 100;
            defender.hp = defender.maxHp;
            gameState.pvpBattles.delete(data.battleId);
          }
          
          battle.turn = isPlayer1 ? 2 : 1;
          broadcastGameState();
        }
        break;

      case 'createGuild':
        if (gameState.players.has(playerId)) {
          const player = gameState.players.get(playerId);
          const guildId = uuidv4();
          gameState.guilds.set(guildId, {
            id: guildId,
            name: data.guildName,
            leader: playerId,
            members: [playerId],
            level: 1,
            funds: 0
          });
          player.guild = guildId;
          broadcastGameState();
        }
        break;

      case 'joinGuild':
        if (gameState.players.has(playerId) && gameState.guilds.has(data.guildId)) {
          const player = gameState.players.get(playerId);
          const guild = gameState.guilds.get(data.guildId);
          guild.members.push(playerId);
          player.guild = data.guildId;
          broadcastGameState();
        }
        break;
    }
  }
});

function broadcastGameState() {
  const state = {
    type: 'gameState',
    players: Array.from(gameState.players.values()),
    mobs: Array.from(gameState.mobs.values()),
    guilds: Array.from(gameState.guilds.values())
  };
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(state));
    }
  });
}

// 초기화
initializeMobs();

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`MMORPG 서버가 포트 ${PORT}에서 실행 중입니다...`);
  console.log(`http://localhost:${PORT}에서 접속하세요`);
});
