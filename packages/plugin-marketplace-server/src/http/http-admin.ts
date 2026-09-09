import { Body, Headers, Param, type Type } from "@nestjs/common";
import type { PublisherAdminView } from "../contracts.ts";
import { applyController, applyHttpCode, applyParameter, applyRoute } from "./http-decorators.ts";
import {
	badRequest,
	bodyBoolean,
	bodyObject,
	bodyString,
	type MarketplaceHttpRuntime,
	mapStoreErrorsAsync,
	requireAdmin,
	USERNAME_PATTERN,
	validatePublisherId,
} from "./http-util.ts";

export function createAdminControllers(runtime: MarketplaceHttpRuntime): Type<unknown>[] {
	class AdminController {
		async publishers(authorization: string | undefined): Promise<{ publishers: PublisherAdminView[] }> {
			await requireAdmin(runtime, authorization);
			const list = await runtime.store.listPublishers();
			return { publishers: list };
		}

		async upsertPublisher(
			publisherId: string,
			body: unknown,
			authorization: string | undefined,
		): Promise<{ publisher: PublisherAdminView }> {
			await requireAdmin(runtime, authorization);
			validatePublisherId(publisherId);
			const record = bodyObject(body);
			const displayName = bodyString(record, "displayName", 120);
			const verified = bodyBoolean(record, "verified");
			const publisher = await runtime.store.upsertPublisher(publisherId, displayName, verified);
			return { publisher };
		}

		async addMember(publisherId: string, username: string, authorization: string | undefined): Promise<void> {
			await requireAdmin(runtime, authorization);
			validateMemberPath(publisherId, username);
			await mapStoreErrorsAsync(() => runtime.store.addPublisherMember(publisherId, username));
		}

		async removeMember(publisherId: string, username: string, authorization: string | undefined): Promise<void> {
			await requireAdmin(runtime, authorization);
			validateMemberPath(publisherId, username);
			await mapStoreErrorsAsync(() => runtime.store.removePublisherMember(publisherId, username));
		}
	}

	applyController(AdminController, "v1/admin");
	applyRoute(AdminController.prototype, "publishers", "get", "publishers");
	applyParameter(AdminController.prototype, "publishers", 0, Headers("authorization"));
	applyRoute(AdminController.prototype, "upsertPublisher", "put", "publishers/:publisherId");
	applyParameter(AdminController.prototype, "upsertPublisher", 0, Param("publisherId"));
	applyParameter(AdminController.prototype, "upsertPublisher", 1, Body());
	applyParameter(AdminController.prototype, "upsertPublisher", 2, Headers("authorization"));
	applyRoute(AdminController.prototype, "addMember", "put", "publishers/:publisherId/members/:username");
	applyHttpCode(AdminController.prototype, "addMember", 204);
	applyParameter(AdminController.prototype, "addMember", 0, Param("publisherId"));
	applyParameter(AdminController.prototype, "addMember", 1, Param("username"));
	applyParameter(AdminController.prototype, "addMember", 2, Headers("authorization"));
	applyRoute(AdminController.prototype, "removeMember", "delete", "publishers/:publisherId/members/:username");
	applyHttpCode(AdminController.prototype, "removeMember", 204);
	applyParameter(AdminController.prototype, "removeMember", 0, Param("publisherId"));
	applyParameter(AdminController.prototype, "removeMember", 1, Param("username"));
	applyParameter(AdminController.prototype, "removeMember", 2, Headers("authorization"));

	return [AdminController];
}

function validateMemberPath(publisherId: string, username: string): void {
	validatePublisherId(publisherId);
	if (!USERNAME_PATTERN.test(username)) {
		throw badRequest("USERNAME_INVALID", "Username must be a lowercase identifier");
	}
}
