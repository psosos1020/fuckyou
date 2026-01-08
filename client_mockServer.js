// Mock WebSocket + 간단 서버 로직 (로컬 오프라인(single-player) 모드용)
// 사용법: 꼬rpg.html에 <script src="client/mockServer.js"></script> 를
//       메인 클라이언트 스크립트보다 먼저 포함하세요.
// 동작: file:// 프로토콜(또는 지정한 경우)에서 window.WebSocket을 가로채서
//       MockWebSocket을 사용합니다. 기본적으로 JSON 메시지 {type: "...", ...}
//       구조를 가정합니다. 실제 메시지 포맷에 맞춰 handleMessage()를 수정하세요.

(function () {
  if (typeof window === 'undefined') return;

  // 자동 동작 조건: file 프로토콜인 경우 자동으로 모의 서버 사용
  // 필요하면 alwaysUseMock = true 로 바꿔서 항상 모의 사용 가능
  const alwaysUseMock = false;
  const useMock = (location && location.protocol === 'file:') || alwaysUseMock;
  if (!useMock) return; // 기본: 로컬 파일에서만 활성화

  // 간단한 유틸
  function uuid() {
    // 짧은 랜덤 id
    return 'id-' + Math.random().toString(36).slice(2, 10);
  }

  // 데이터베이스(원본 server/server.js의 일부를 간단화해서 사용)
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

  const skillDatabase = {
    warrior: [
      { id: 'slash', name: '슬래시', dmg: 1.2, mp: 10, level: 1 },
      { id: 'power_slash', name: '파워 슬래시', dmg: 1.8, mp: 20, level: 10 }
    ],
    mage: [
      { id: 'fireball', name: '파이어볼', dmg: 1.3, mp: 15, level: 1 }
    ]
  };

  // 서버 상태(단일 플레이어용)
  const serverState = {
    players: {}, // id -> player
    mobs: {},
    items: {},
  };

  // 기본 몹 생성
  function spawnDefaultMobs() {
    serverState.mobs = {};
    const mob1 = { id: 'mob-' + uuid(), name: '슬라임', hp: 100, maxHp: 100, atk: 5, def: 1, x: 200, y: 150 };
    const mob2 = { id: 'mob-' + uuid(), name: '늑대', hp: 150, maxHp: 150, atk: 8, def: 2, x: 300, y: 250 };
    serverState.mobs[mob1.id] = mob1;
    serverState.mobs[mob2.id] = mob2;
  }
  spawnDefaultMobs();

  // MockWebSocket 클래스
  class MockWebSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = MockWebSocket.OPEN;
      this._listeners = { open: [], message: [], close: [], error: [] };
      this._binaryType = 'arraybuffer';

      // create a local "connection" (simulate slight delay)
      setTimeout(() => {
        this._dispatchEvent('open', {});
        // 자동으로 서버가 초기 상태를 푸시할 수도 있음
        this._sendServerMessage({ type: 'welcome', msg: 'Mock server connected' });
      }, 10);
    }

    // EventTarget-like
    addEventListener(type, cb) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(cb);
    }
    removeEventListener(type, cb) {
      if (!this._listeners[type]) return;
      this._listeners[type] = this._listeners[type].filter(f => f !== cb);
    }
    _dispatchEvent(type, ev) {
      const list = this._listeners[type] || [];
      list.forEach(cb => {
        try { cb(ev); } catch (e) { console.error(e); }
      });
      // onopen/onmessage style handlers
      const handler = this['on' + type];
      if (typeof handler === 'function') {
        try { handler(ev); } catch (e) { console.error(e); }
      }
    }

    // 클라이언트가 보낸 메시지
    send(data) {
      // 문자열이면 JSON으로 파싱 시도
      let msg = null;
      if (typeof data === 'string') {
        try { msg = JSON.parse(data); } catch (e) { msg = { raw: data }; }
      } else {
        // 바이너리 또는 기타: echo
        this._sendServerMessage({ type: 'echo', data });
        return;
      }
      this._handleClientMessage(msg);
    }

    close(code, reason) {
      this.readyState = MockWebSocket.CLOSED;
      this._dispatchEvent('close', { code, reason });
    }

    // 서버 -> 클라이언트 메시지 전송(내부)
    _sendServerMessage(obj) {
      const ev = { data: JSON.stringify(obj) };
      // setTimeout으로 비동기 전달
      setTimeout(() => this._dispatchEvent('message', ev), 10);
    }

    // 실제 메시지 처리 로직 (클라이언트에서 보내는 명령 처리)
    _handleClientMessage(msg) {
      if (!msg || typeof msg !== 'object') {
        this._sendServerMessage({ type: 'error', msg: 'invalid message' });
        return;
      }

      // 흔한 메시지 구조: { type: "join", name: "..." }, { type: "action", ... }
      const t = msg.type;
      switch (t) {
        case 'join':
          {
            const playerId = 'player-' + uuid();
            const p = {
              id: playerId,
              name: msg.name || 'local',
              hp: 200, maxHp: 200, mp: 50, lvl: 1,
              atk: 12, def: 3, x: 100, y: 100,
              items: [ itemDatabase.weapon[0].id ]
            };
            serverState.players[playerId] = p;
            // 응답: 가입 확인 + 초기 전체 상태
            this._sendServerMessage({ type: 'joined', playerId });
            this._sendServerMessage({ type: 'state_init', state: snapshotState() });
            break;
          }
        case 'get_state':
          this._sendServerMessage({ type: 'state', state: snapshotState() });
          break;
        case 'attack':
          {
            // {type:'attack', actorId:..., targetId:...}
            const actor = serverState.players[msg.actorId];
            const target = serverState.mobs[msg.targetId] || serverState.players[msg.targetId];
            if (!actor || !target) {
              this._sendServerMessage({ type: 'error', msg: 'invalid actor/target' });
              break;
            }
            const atk = actor.atk || 5;
            const def = target.def || 0;
            const dmg = Math.max(1, Math.round(atk - def + Math.random() * 3));
            target.hp = Math.max(0, (target.hp || target.maxHp) - dmg);

            // 전투 로그와 상태 갱신 이벤트
            this._sendServerMessage({ type: 'combat', actorId: actor.id, targetId: target.id, dmg });
            this._broadcastStateUpdate();
            // 죽음 처리(간단)
            if (target.hp <= 0) {
              this._sendServerMessage({ type: 'killed', targetId: target.id });
              // 몹 재스폰 (간단)
              if (serverState.mobs[target.id]) {
                delete serverState.mobs[target.id];
                setTimeout(() => {
                  spawnDefaultMobs();
                  this._broadcastStateUpdate();
                }, 1000);
              }
            }
            break;
          }
        case 'move':
          {
            // {type:'move', actorId, x, y}
            const p = serverState.players[msg.actorId];
            if (!p) { this._sendServerMessage({ type: 'error', msg: 'invalid actor' }); break; }
            p.x = msg.x; p.y = msg.y;
            this._broadcastStateUpdate();
            break;
          }
        case 'chat':
          {
            // 간단히 그대로 푸시
            this._sendServerMessage({ type: 'chat', from: msg.from || 'local', text: msg.text });
            break;
          }
        default:
          // 알 수 없는 타입은 단순 에코
          this._sendServerMessage({ type: 'unknown', received: msg });
      }
    }

    // 모든 연결된 클라이언트가 하나밖에 없으므로 현재 소켓에만 전송
    _broadcastStateUpdate() {
      this._sendServerMessage({ type: 'state_patch', state: snapshotState() });
    }
  }

  // readyState 상수
  MockWebSocket.CONNECTING = 0;
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSING = 2;
  MockWebSocket.CLOSED = 3;

  // 현재 상태 스냅샷을 직렬화 가능한 객체로 반환
  function snapshotState() {
    return {
      players: Object.values(serverState.players),
      mobs: Object.values(serverState.mobs),
      items: itemDatabase
    };
  }

  // 실제 window.WebSocket을 덮어쓰기 전에 보관
  window.__RealWebSocket__ = window.WebSocket;

  // 교체: MockWebSocket을 전역 WebSocket으로 설정
  window.WebSocket = MockWebSocket;

  // 디버그 정보 노출
  window.__mockServerState__ = serverState;
  window.__mockServerSnapshot__ = snapshotState;

  console.info('[MockServer] 활성화: window.WebSocket이 MockWebSocket으로 교체되었습니다. (file:// or forced)');
})();