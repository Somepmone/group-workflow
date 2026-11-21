import { relations } from "drizzle-orm/relations";
import { projects, nodes, members } from "./schema";

export const nodesRelations = relations(nodes, ({one}) => ({
	project: one(projects, {
		fields: [nodes.projectId],
		references: [projects.id]
	}),
}));

export const projectsRelations = relations(projects, ({many}) => ({
	nodes: many(nodes),
	members: many(members),
}));

export const membersRelations = relations(members, ({one}) => ({
	project: one(projects, {
		fields: [members.projectId],
		references: [projects.id]
	}),
}));