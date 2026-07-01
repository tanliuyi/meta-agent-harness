/**
 * 定义 extension UI request 在 desktop transport 中的结构。
 */

/** Extension UI 请求联合类型。 */
export type ExtensionUiRequest =
	| {
			/** 请求类型：单选。 */
			type: "select";
			/** 请求 ID。 */
			id: string;
			/** 标题。 */
			title: string;
			/** 选项列表。 */
			options: string[];
			/** 超时时间，单位毫秒。 */
			timeoutMs?: number;
	  }
	| {
			/** 请求类型：确认。 */
			type: "confirm";
			/** 请求 ID。 */
			id: string;
			/** 标题。 */
			title: string;
			/** 消息内容。 */
			message: string;
			/** 超时时间，单位毫秒。 */
			timeoutMs?: number;
	  }
	| {
			/** 请求类型：输入。 */
			type: "input";
			/** 请求 ID。 */
			id: string;
			/** 标题。 */
			title: string;
			/** 占位提示文本。 */
			placeholder?: string;
			/** 超时时间，单位毫秒。 */
			timeoutMs?: number;
	  }
	| {
			/** 请求类型：编辑器。 */
			type: "editor";
			/** 请求 ID。 */
			id: string;
			/** 标题。 */
			title: string;
			/** 预填充文本。 */
			prefill?: string;
	  }
	| {
			/** 请求类型：通知。 */
			type: "notify";
			/** 请求 ID。 */
			id: string;
			/** 通知消息。 */
			message: string;
			/** 通知类型。 */
			notifyType?: "info" | "warning" | "error";
	  }
	| {
			/** 请求类型：设置状态。 */
			type: "setStatus";
			/** 请求 ID。 */
			id: string;
			/** 状态键。 */
			statusKey: string;
			/** 状态文本。 */
			statusText?: string;
	  }
	| {
			/** 请求类型：设置小组件。 */
			type: "setWidget";
			/** 请求 ID。 */
			id: string;
			/** 组件键。 */
			widgetKey: string;
			/** 组件文本行。 */
			widgetLines?: string[];
			/** 组件位置。 */
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| {
			/** 请求类型：设置标题。 */
			type: "setTitle";
			/** 请求 ID。 */
			id: string;
			/** 标题。 */
			title: string;
	  }
	| {
			/** 请求类型：设置编辑器文本。 */
			type: "setEditorText";
			/** 请求 ID。 */
			id: string;
			/** 文本内容。 */
			text: string;
	  };

/** Extension UI 响应联合类型。 */
export type ExtensionUiResponse =
	| {
			/** 请求 ID。 */
			id: string;
			/** 输入或选择值。 */
			value: string;
	  }
	| {
			/** 请求 ID。 */
			id: string;
			/** 是否确认。 */
			confirmed: boolean;
	  }
	| {
			/** 请求 ID。 */
			id: string;
			/** 是否取消。 */
			cancelled: true;
	  };
