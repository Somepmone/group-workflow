import { pgTable, serial, timestamp, index, foreignKey, varchar, jsonb, integer, uniqueIndex, date, boolean, text } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const nodes = pgTable("nodes", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
	projectId: varchar("project_id", { length: 36 }).notNull(),
	name: varchar({ length: 128 }).notNull(),
	type: varchar({ length: 16 }).default('linear').notNull(),
	assignee: varchar({ length: 64 }),
	// 负责人昵称数组（多选，assignee 兼容保留为 assignees[0]）
	assignees: jsonb("assignees").default([]).notNull(),
	ddl: timestamp({ withTimezone: true, mode: 'string' }),
	strictness: varchar({ length: 16 }).default('soft').notNull(),
	// 节点形态: ddl(截止日型) / point(点状节点，无 DDL，仅具体日期/时间段，如会议、答辩)
	nodeKind: varchar("node_kind", { length: 16 }).default('ddl').notNull(),
	pointDate: date("point_date", { mode: 'string' }),
	pointAllDay: boolean("point_all_day").default(true).notNull(),
	pointStartTime: varchar("point_start_time", { length: 8 }),
	pointEndTime: varchar("point_end_time", { length: 8 }),
	// 备注（取代严格程度在实际使用中的角色；strictness 字段保留但不再读写）
	note: text("note").default(''),
	// 状态: 仅存储用户主动设置值 todo(默认/未标记) / done(已完成) / blocked(卡住了)；
	//「未开始/进行中/已超时」由 node-status 按当前时间与节点时间区间实时派生，不落库
	prevNodeIds: jsonb("prev_node_ids").default([]).notNull(),
	status: varchar({ length: 16 }).default('todo').notNull(),
	// 卡住说明（status='blocked' 时必填）
	blockedNote: text("blocked_note"),
	// 完成时间（status='done' 时写入）
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	position: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	intentPrevNodeIds: jsonb("intent_prev_node_ids").default([]).notNull(),
}, (table) => [
	index("nodes_project_id_idx").using("btree", table.projectId.asc().nullsLast().op("text_ops")),
	index("nodes_project_position_idx").using("btree", table.projectId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	index("nodes_project_status_idx").using("btree", table.projectId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "nodes_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const members = pgTable("members", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
	projectId: varchar("project_id", { length: 36 }).notNull(),
	name: varchar({ length: 64 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("members_project_id_idx").using("btree", table.projectId.asc().nullsLast().op("text_ops")),
	uniqueIndex("members_project_name_unique").using("btree", table.projectId.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "members_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);

export const projects = pgTable("projects", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
	name: varchar({ length: 128 }).notNull(),
	template: varchar({ length: 32 }).default('blank').notNull(),
	ownerName: varchar("owner_name", { length: 64 }).notNull(),
	// 锁定状态: none(未锁定) / workflow(工作流已锁定，仅负责人/小组长可改结构) / full(完全锁定)
	lockState: varchar("lock_state", { length: 16 }).default('none').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("projects_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const nodeComments = pgTable("node_comments", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
	projectId: varchar("project_id", { length: 36 }).notNull(),
	nodeId: varchar("node_id", { length: 36 }).notNull(),
	authorName: varchar("author_name", { length: 64 }).notNull(),
	content: text("content").notNull(),
	// 评论类型: comment(普通评论) / help(求助)
	kind: varchar({ length: 16 }).default('comment').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("node_comments_node_id_idx").using("btree", table.nodeId.asc().nullsLast().op("text_ops")),
	index("node_comments_project_id_idx").using("btree", table.projectId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.nodeId],
			foreignColumns: [nodes.id],
			name: "node_comments_node_id_nodes_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "node_comments_project_id_projects_id_fk"
		}).onDelete("cascade"),
]);
