import React from 'react';
import { Box, Button, Flex, Select, Switch, Text } from '@chakra-ui/react';

import {
  MONGO_READ_ONLY_AGGREGATION_STAGES,
  type MongoReadOnlyAggregationStage
} from '~/api/utils/mongodb/queryContract';
import { BsonValueEditor } from './BsonValueEditor';
import { createPipelineStage, type PipelineStage } from './queryBuilderState';

type Props = {
  value: PipelineStage[];
  onChange: (value: PipelineStage[]) => void;
};

const inputStyles = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

const PipelineBuilderComponent = ({ value, onChange }: Props) => {
  const update = (index: number, stage: PipelineStage) => {
    const next = [...value];
    next[index] = stage;
    onChange(next);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const changeStage = (index: number, stageName: MongoReadOnlyAggregationStage) => {
    const next = createPipelineStage(stageName);
    next.id = value[index].id;
    next.enabled = value[index].enabled;
    update(index, next);
  };

  return (
    <Flex flexDirection="column" rowGap={3} minWidth={0}>
      {value.map((stage, index) => (
        <Flex
          key={stage.id}
          flexDirection="column"
          rowGap={3}
          padding={{ base: 3, md: 4 }}
          border="1px solid var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-md, 12px)"
          background="var(--tt-card, #ffffff)"
          opacity={stage.enabled ? 1 : 0.58}
          minWidth={0}
        >
          <Flex alignItems="center" gap={2} flexWrap="wrap">
            <Text fontFamily="mono" fontSize="xs" fontWeight={700} color="var(--tt-muted, #777783)">
              {index + 1}
            </Text>
            <Select
              aria-label={`Aggregation stage ${index + 1}`}
              size="sm"
              width={{ base: '100%', sm: '230px' }}
              value={stage.stage}
              onChange={(event) => changeStage(index, event.target.value as MongoReadOnlyAggregationStage)}
              {...inputStyles}
            >
              {MONGO_READ_ONLY_AGGREGATION_STAGES.map((stageName) => (
                <option key={stageName} value={stageName}>
                  {stageName}
                </option>
              ))}
            </Select>
            <Flex alignItems="center" gap={1} marginLeft={{ base: 0, sm: 'auto' }}>
              <Text fontSize="xs" color="var(--tt-muted, #777783)">
                {stage.enabled ? 'On' : 'Off'}
              </Text>
              <Switch
                aria-label={`Enable aggregation stage ${index + 1}`}
                size="sm"
                isChecked={stage.enabled}
                onChange={(event) => update(index, { ...stage, enabled: event.target.checked })}
              />
            </Flex>
            <Button aria-label="Move stage up" size="xs" variant="ghost" isDisabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </Button>
            <Button
              aria-label="Move stage down"
              size="xs"
              variant="ghost"
              isDisabled={index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </Button>
            <Button
              aria-label="Remove aggregation stage"
              size="xs"
              variant="ghost"
              colorScheme="red"
              onClick={() => onChange(value.filter((_, stageIndex) => stageIndex !== index))}
            >
              ✕
            </Button>
          </Flex>
          <Box minWidth={0}>
            <BsonValueEditor value={stage.value} onChange={(next) => update(index, { ...stage, value: next })} />
          </Box>
        </Flex>
      ))}

      <Flex alignItems="center" gap={3} flexWrap="wrap">
        <Button size="sm" variant="outline" onClick={() => onChange([...value, createPipelineStage('$match')])}>
          + Add pipeline stage
        </Button>
        <Text fontSize="xs" color="var(--tt-muted, #777783)">
          Atlas and newer-server stages stay selectable; MongoDB will explain when the connected deployment does not support one.
        </Text>
      </Flex>
    </Flex>
  );
};

export const PipelineBuilder = React.memo(PipelineBuilderComponent);
