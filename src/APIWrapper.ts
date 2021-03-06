import localforage from "localforage";
import { nFetch as fetch } from "./customFetch";
import {
  Community,
  DisadusToast,
  PublicUser,
  User,
} from "./types/DisadusTypes";
import { LMSLinkedUser } from "./types/LMSTypes";
export type RequestResponse<T> = {
  event: string;
  success: boolean;
  data: T;
};
export type RawResponse<T> = {
  requestID: string;
  response: RequestResponse<T>;
};
export type RawRequest<T> = {
  requestID: string;
  event: string;
  request: T;
};
export type TokenInfo = {
  token: string;
  expires: number;
} | null;
export enum PluginIntent {
  // Chat
  getSelf = "getSelf",
  getUser = "getUser",
  getUsers = "getUsers",
  getAssignment = "getAssignment",
  getCourse = "getCourse",
  getCommunity = "getCommunity",
  getLMSLinkedSelf = "getLMSLinkedSelf",
}
export class APIWrapper {
  _ready: boolean = false;
  _parent: MessageEventSource | null = null;
  _token: TokenInfo = null;
  requests: Map<string, (data: RawResponse<any>) => void> = new Map();
  boundReady?: (data: MessageEvent<any>) => void;
  get readyState(): boolean {
    return this._ready;
  }
  static _self: APIWrapper;
  static getInstance(): APIWrapper {
    if (!APIWrapper._self) {
      APIWrapper._self = new APIWrapper();
    }
    return APIWrapper._self;
  }

  constructor(node?: boolean) {
    if (!node) this.init();
  }
  init() {
    if (window.top) {
      console.log("[APIWrapper]", "Constructing APIWrapper");
      window.top.postMessage(
        JSON.stringify({
          event: "connect",
        }),
        "*",
        []
      );
    } else {
      console.error("No window.top");
    }
    this.boundReady = this.ready.bind(this);
    window.addEventListener("message", this.boundReady);
    localforage.getItem("__$DisadusAppToken").then((store) => {
      const token = store as TokenInfo;
      if (token && token.expires > Date.now()) {
        this._token = token as TokenInfo;
      }
    });
  }
  processMessage(event: MessageEvent): void {
    const message = JSON.parse(event.data) as RawResponse<any>;
    if (message.response) {
      const callback = this.requests.get(message.requestID);
      if (callback) {
        callback(message);
      }
      this.requests.delete(message.requestID);
    }
    if (message.response.event === "token" && message.response.data) {
      this._token = message.response.data;
      console.log("[APIWrapper]", "Refreshed token", this._token);
    }
  }
  ready(event: MessageEvent): void {
    if (this._ready) {
      console.error("[APIWrapper]", "Already ready");
      return;
    }
    if (typeof event.data !== "string") {
      return;
    }
    try {
      JSON.parse(event.data);
    } catch (error) {
      return;
    }
    console.log("[APIWrapper]", "Readying", JSON.parse(event.data));
    const tokenInfo = JSON.parse(event.data) as RawResponse<TokenInfo>;
    this._token = tokenInfo.response.data;
    if (!this._token) return;
    this._ready = true;

    console.log("[APIWrapper]", "Token", this._token, this);
    localforage.setItem("__$DisadusAppToken", this._token);
    window.addEventListener("message", this.processMessage.bind(this));
    window.removeEventListener("message", this.boundReady!);
  }
  getRequestId() {
    let requestId = Math.random().toString(36).substring(2);
    while (this.requests.has(requestId)) {
      requestId = Math.random().toString(36).substring(2);
    }
    return requestId;
  }
  sendRequest(name: string, data: any): Promise<RequestResponse<any>> {
    return new Promise(async (resolve, reject) => {
      const requestId = this.getRequestId();
      const message = {
        requestID: requestId,
        event: name,
        request: data,
      } as RawRequest<any>;
      while (!this._ready) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      window.top?.postMessage(JSON.stringify(message), "*", []);
      this.requests.set(requestId, (response) => {
        resolve(response.response);
      });
    });
  }
  async requestIntents(intents: PluginIntent[]) {
    const result = (await this.sendRequest("requestIntents", {
      intents,
    })) as RequestResponse<TokenInfo>;
    if (result.success) {
      this._token = result.data;
    } else {
      console.error("[APIWrapper]", "RequestIntents failed", result);
    }
    return result.success;
  }
  async waitForToken() {
    console.log("[APIWrapper]", "Waiting for token", this);
    while (!this._token) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    console.log("[APIWrapper]", "Got token", this._token);
    return this._token;
  }
  async getUser(userid: string): Promise<PublicUser | null> {
    return fetch(`https://api.disadus.app/user/${userid}`, {})
      .then((res) => res.json() as Promise<PublicUser | null>)
      .catch(() => null);
  }
  async getSelf(): Promise<User | null> {
    const token = await this.waitForToken();
    return fetch(`https://api.disadus.app/user/@me`, {
      headers: {
        Authorization: `Plugin ${token.token}`,
      },
    })
      .then((res) => res.json() as Promise<User | null>)
      .catch(() => null);
  }
  async getCommunity(communityid: string): Promise<Community | null> {
    return fetch(`https://api.disadus.app/community/${communityid}`, {})
      .then((res) => res.json() as Promise<Community | null>)
      .catch(() => null);
  }
  async getLMSSelf(communityID: string) {
    const token = await this.waitForToken();
    return fetch(`https://api.disadus.app/community/${communityID}/LMS/@me`, {
      headers: {
        Authorization: `Plugin ${token.token}`,
      },
    })
      .then((res) => res.json() as Promise<LMSLinkedUser | null>)
      .catch(() => null);
  }
  async sendToast(toast: DisadusToast) {
    const toastResponse = this.sendRequest("sendToast", toast) as Promise<
      RequestResponse<{ success: boolean }>
    >;
    return toastResponse.then((response) => response.success);
  }
}
