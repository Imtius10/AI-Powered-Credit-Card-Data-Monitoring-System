import { Controller, Get, Param } from '@nestjs/common';
import { CardsService } from './cards.service';
import type { CardsResponse } from './cards.service';

@Controller('cards')
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Get()
  async getCards(): Promise<CardsResponse> {
    return this.cardsService.getCardsResponse();
  }

  @Get(':id/history')
  async getHistory(@Param('id') id: string) {
    return this.cardsService.getCardHistory(id);
  }
}
