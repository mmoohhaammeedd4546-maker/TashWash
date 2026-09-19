CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`action` varchar(80) NOT NULL,
	`entity` varchar(80) NOT NULL,
	`entityId` varchar(80),
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename` varchar(160) NOT NULL,
	`payload` text NOT NULL,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_counters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`counterDate` varchar(10) NOT NULL,
	`lastValue` int NOT NULL DEFAULT 0,
	CONSTRAINT `invoice_counters_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_counters_counterDate_unique` UNIQUE(`counterDate`)
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceId` int NOT NULL,
	`serviceId` int NOT NULL,
	`serviceName` varchar(160) NOT NULL,
	`quantity` int NOT NULL,
	`unitPriceCents` int NOT NULL,
	`totalCents` int NOT NULL,
	CONSTRAINT `invoice_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceNumber` varchar(32) NOT NULL,
	`customerName` varchar(160),
	`customerPhone` varchar(32),
	`plateNumber` varchar(32),
	`carModel` varchar(120),
	`subtotalCents` int NOT NULL,
	`discountCents` int NOT NULL DEFAULT 0,
	`vatCents` int NOT NULL,
	`totalCents` int NOT NULL,
	`paymentMethod` enum('cash','card','bank_transfer') NOT NULL,
	`notes` text,
	`cashierId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_invoiceNumber_unique` UNIQUE(`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`priceCents` int NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int NOT NULL,
	`washName` varchar(160) NOT NULL DEFAULT 'طش ورش',
	`phone` varchar(32),
	`address` varchar(255),
	`vatNumber` varchar(64),
	`taxRateBasisPoints` int NOT NULL DEFAULT 1500,
	`logo` text,
	`invoiceFooter` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `name` varchar(160);--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','cashier','user') NOT NULL DEFAULT 'cashier';--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mustChangePassword` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `backups_created_idx` ON `backups` (`createdAt`);--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `invoices_created_idx` ON `invoices` (`createdAt`);--> statement-breakpoint
CREATE INDEX `invoices_plate_idx` ON `invoices` (`plateNumber`);--> statement-breakpoint
CREATE INDEX `services_active_idx` ON `services` (`active`);
