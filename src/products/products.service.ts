import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import {
  paginate,
  type Paginated,
} from '../common/dto/paginated-response.dto.js';
import type { CreateProductDto } from './dto/create-product.dto.js';
import type { QueryProductsDto } from './dto/query-products.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';
import { Product } from './entities/product.entity.js';

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  create(dto: CreateProductDto): Promise<Product> {
    return this.productsRepository.save(this.productsRepository.create(dto));
  }

  async findAll(query: QueryProductsDto): Promise<Paginated<Product>> {
    const { page, limit, search } = query;
    const [data, total] = await this.productsRepository.findAndCount({
      where: search ? { name: Like(`%${escapeLike(search)}%`) } : {},
      order: { id: 'ASC' },
      skip: query.skip,
      take: limit,
    });
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<Product> {
    const product = await this.productsRepository.findOneBy({ id });
    if (!product) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }
    return product;
  }

  async update(id: number, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);
    this.productsRepository.merge(product, dto);
    return this.productsRepository.save(product);
  }

  async remove(id: number): Promise<void> {
    const { affected } = await this.productsRepository.delete({ id });
    if (!affected) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }
  }
}
