const MODULE_ID = "fvtt-sync-minimap";

/**
 * 현재 체크되어 있는 플레이어 ID.
 *
 * UI가 다시 렌더돼도 선택 상태를 잠깐 유지하기 위해
 * DOM 자체가 아니라 JS Set으로 들고 있는다.
 */
const selectedUsers = new Set();

Hooks.on("renderChatMessage", (message, html) => {

  console.log("renderChatMessage fired");
  console.log("message:", message);
  console.log("html:", html);
  console.log("flags:", message.flags);
  console.log("MODULE_ID:", MODULE_ID);
  /*console.log("data:", data);*/

  const directed = message.flags?.[MODULE_ID]?.directed;

  if (!directed) return;

  console.log("우리 메시지:", message);
  console.log("HTML:", html);
  /*
   * Foundry whisper 표시 제거.
   *
   * 실제 v12 DOM class는 한번 확인하면서
   * selector를 맞추면 된다.
   */
  html.find(".whisper-to").remove();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
});


/**
 * Foundry v12의 ChatLog가 렌더될 때 호출된다.
 *
 * v12에서는 renderChatLog를 이용해서
 * 기존 채팅창 UI에 요소를 삽입할 수 있다.
 */
Hooks.on("renderChatLog", (app, html) => {
  if (!game.user.isGM) return;

  installDirectorUI(html);
});


/**
 * 채팅창에 우리 UI 설치.
 */
function installDirectorUI(html) {

  /*
   * renderChatLog가 여러 번 호출될 수 있으므로
   * 중복 생성 방지.
   */
  if (html.find("#fld-director").length) return;


  const chatInput = html.find("#chat-message");

  if (!chatInput.length) {
    console.warn(`${MODULE_ID} | #chat-message not found`);
    return;
  }


  const directorHTML = $(`
  <section id="fld-director">

    <div class="fld-toolbar">
      <button
        type="button"
        id="fld-target-button"
      >
        <i class="fas fa-users"></i>
        대상 설정
      </button>

      <span id="fld-target-count">
        대상 없음
      </span>
    </div>

    <div
      id="fld-player-selector"
      class="fld-hidden"
    >
      <div class="fld-player-list"></div>
    </div>


    <div class="fld-normal-row">

      <span class="fld-normal-name">
        기본
      </span>

      <textarea
        id="fld-normal-input"
        rows="1"
        placeholder="정상 로그"
      ></textarea>

    </div>


    <div id="fld-override-list"></div>


    <button
      type="button"
      id="fld-send-button"
    >
      Illusion Send
    </button>

  </section>
`);


  /*
   * 기존 채팅 textarea 바로 앞에 삽입.
   */
  chatInput.before(directorHTML);


  buildPlayerCheckboxes(html);

  bindDirectorControls(html);

  rebuildOverrideInputs(html);
}


/**
 * 현재 월드의 플레이어 목록을 가져와
 * 체크박스 생성.
 */
function buildPlayerCheckboxes(html) {

  const container =
    html.find("#fld-player-selector .fld-player-list");

  container.empty();


  /*
   * Foundry v12 공식 Users.players
   *
   * Player 역할 사용자만 나온다.
   * GM은 포함되지 않는다.
   */
  const players = game.users.players;


  if (!players.length) {

    container.append(`
      <div class="fld-empty">
        등록된 플레이어가 없습니다.
      </div>
    `);

    return;
  }


  for (const user of players) {

    const checked =
      selectedUsers.has(user.id)
        ? "checked"
        : "none";


    const activeClass =
      user.active
        ? "fld-online"
        : "fld-offline";


    const statusText =
      user.active
        ? "접속"
        : "오프라인";


    const row = $(`
      <label class="fld-player-row">

        <input
          type="checkbox"
          class="fld-player-checkbox"
          value="${user.id}"
          ${checked}
        >

        <span class="fld-player-name">
          ${escapeHTML(user.name)}
        </span>

        <span class="fld-status ${activeClass}">
          ${statusText}
        </span>

      </label>
    `);


    container.append(row);
  }
}


/**
 * 설정창 버튼 및 체크박스 처리.
 */
function bindDirectorControls(html) {

  const selector =
    html.find("#fld-player-selector");


  html
    .find("#fld-target-button")
    .on("click", () => {

      selector.toggleClass("fld-hidden");

    });


  html
    .find(".fld-player-checkbox")
    .on("change", function () {

      const userId = this.value;

      if (this.checked) {
        selectedUsers.add(userId);
      }

      else {
        selectedUsers.delete(userId);
      }

      rebuildOverrideInputs(html);
    });


  /*
   * 우리 Illusion Chat 전용 송신 버튼
   */
  html
    .find("#fld-send-button")
    .on("click", async () => {

      try {

        await sendDirectedMessage(html);

      }

      catch (error) {

        console.error(
          `${MODULE_ID} | Illusion send failed`,
          error
        );

        ui.notifications.error(
          "Illusion Chat 전송 실패"
        );

      }

    });
}

/**
 * 체크된 플레이어마다
 * 개별 문자열 입력칸 생성.
 */
function rebuildOverrideInputs(html) {

  const container =
    html.find("#fld-override-list");


  /*
   * 기존 입력값 보존.
   *
   * 체크박스 하나 건드릴 때
   * 다른 플레이어에게 써놓은 문장이 사라지면 귀찮다.
   */
  const savedValues = new Map();


  container
    .find(".fld-override")
    .each(function () {

      savedValues.set(
        this.dataset.userId,
        this.value
      );

    });


  container.empty();


  for (const userId of selectedUsers) {

    const user =
      game.users.get(userId);


    if (!user) continue;


    const row = $(`
      <div class="fld-override-row">

        <span class="fld-override-name">
          ${escapeHTML(user.name)}
        </span>

        <textarea
          class="fld-override"
          data-user-id="${user.id}"
          rows="1"
          placeholder="비워두면 기본 메시지"
        ></textarea>

      </div>
    `);


    const input =
      row.find(".fld-override");


    input.val(
      savedValues.get(user.id) ?? ""
    );


    container.append(row);
  }


  updateTargetCount(html);
}


/**
 * 현재 대상 표시.
 */
function updateTargetCount(html) {

  const count =
    selectedUsers.size;


  const label =
    count
      ? `${count}명 선택`
      : "대상 없음";


  html
    .find("#fld-target-count")
    .text(label);
}


/**
 * 기존 Foundry 채팅 입력 Enter를 가로챈다.
 */
function bindChatIntercept(html) {

  const chatInput =
    html.find("#chat-message")[0];


  if (!chatInput) return;


  /*
   * jQuery .on() 대신 native listener 사용.
   *
   * true = capture phase
   *
   * Foundry의 기존 keydown 처리보다 먼저
   * 이벤트를 받을 가능성을 확보한다.
   */
  chatInput.addEventListener(
    "keydown",
    onChatKeyDown,
    true
  );
}


/**
 * 기존 채팅 Enter 처리.
 */
function onChatKeyDown(event) {

  /*
   * Enter가 아니면 Foundry에게 그대로 넘긴다.
   */
  if (event.key !== "Enter") return;


  /*
   * Shift + Enter는 줄바꿈.
   */
  if (event.shiftKey) return;


  /*
   * 개별 송신 대상이 없으면
   * 완전히 원래 Foundry 채팅처럼 동작한다.
   */
  if (!selectedUsers.size) return;


  /*
   * 여기부터는 Foundry 기본 전송을 막는다.
   *
   * 즉 기본 문자열이 public ChatMessage로
   * 생성되는 것을 차단한다.
   */
  event.preventDefault();

  event.stopPropagation();

  event.stopImmediatePropagation();


  /*
   * Hook은 sync이므로 여기서는
   * async 함수를 호출만 한다.
   */
  sendDirectedMessage(event.currentTarget)
    .catch(error => {

      console.error(
        `${MODULE_ID} | Directed send failed`,
        error
      );

      ui.notifications.error(
        "개별 메시지 전송에 실패했습니다."
      );

    });
}


/**
 * 실제 개별 메시지 송신.
 */async function sendDirectedMessage(html) {

  const defaultContent =
    html
      .find("#fld-normal-input")
      .val()
      .trim();


  const overrides =
    new Map();


  html
    .find(".fld-override")
    .each(function () {

      overrides.set(
        this.dataset.userId,
        this.value.trim()
      );

    });


  const groups =
    new Map();


  for (const userId of selectedUsers) {

    const user =
      game.users.get(userId);

    if (!user) continue;


    const override =
      overrides.get(userId) ?? "";


    /*
     * 플레이어별 입력이 있으면 그것.
     * 없으면 Illusion Chat의 기본 입력.
     */
    const content =
      override || defaultContent;


    if (!content) continue;


    if (!groups.has(content)) {
      groups.set(content, []);
    }


    groups
      .get(content)
      .push(userId);
  }


  if (!groups.size) {
    ui.notifications.warn(
      "보낼 메시지가 없습니다."
    );

    return;
  }


  const groupId =
    foundry.utils.randomID();


  const messageData = [];


  for (
    const [content, recipients]
    of groups
  ) {

    messageData.push({

      user:
        game.user.id,

      speaker:
        ChatMessage.getSpeaker(),

      content,

      whisper:
        recipients,

      flags: {

        [MODULE_ID]: {

          groupId,

          normalContent:
            defaultContent,

          directed:
            true,

          illusion:
            true

        }

      }

    });
  }


  await ChatMessage.createDocuments(
    messageData
  );


  /*
   * Illusion Chat 입력창만 비운다.
   *
   * Foundry 기본 채팅 입력은 전혀 건드리지 않는다.
   */
  html
    .find("#fld-normal-input")
    .val("");


  html
    .find(".fld-override")
    .val("");


  console.log(
    `${MODULE_ID} | Illusion group sent`,
    groupId
  );
}


/**
 * 플레이어 이름 HTML escape.
 */
function escapeHTML(value) {

  const div =
    document.createElement("div");


  div.textContent =
    value;


  return div.innerHTML;
}