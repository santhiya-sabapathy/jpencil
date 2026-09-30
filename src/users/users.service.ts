import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  existsByEmail(email: string): Promise<boolean> {
    return this.usersRepository.exists({ where: { email } });
  }

  /** The only lookup that loads the password hash - used for login. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async create(data: Pick<User, 'name' | 'email' | 'password'>): Promise<User> {
    const { id } = await this.usersRepository.save(
      this.usersRepository.create(data),
    );
    // Re-read so the returned entity never carries the password hash.
    return this.usersRepository.findOneByOrFail({ id });
  }
}
