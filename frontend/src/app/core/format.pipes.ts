import { Pipe, PipeTransform } from '@angular/core';
import { conditionLabel, languageLabel, variantLabel } from './labels';
import { formatCents } from './money';

@Pipe({ name: 'brl' })
export class BrlPipe implements PipeTransform {
  transform(cents: number | null | undefined): string {
    return formatCents(cents);
  }
}

@Pipe({ name: 'condition' })
export class ConditionPipe implements PipeTransform {
  transform(v: string): string {
    return conditionLabel(v);
  }
}

@Pipe({ name: 'variant' })
export class VariantPipe implements PipeTransform {
  transform(v: string): string {
    return variantLabel(v);
  }
}

@Pipe({ name: 'lang' })
export class LanguagePipe implements PipeTransform {
  transform(v: string): string {
    return languageLabel(v);
  }
}
