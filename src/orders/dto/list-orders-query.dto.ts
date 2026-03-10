import { Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';

export enum SortBy {
  createdAt = 'createdAt',
  totalAmount = 'totalAmount',
}

export enum SortOrder {
  asc = 'asc',
  desc = 'desc',
}

export class ListOrdersQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  // ISO string
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsEnum(SortBy)
  sortBy?: SortBy = SortBy.createdAt;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.desc;

  @IsOptional()
  @IsBooleanString()
  noCache?: string;
}
