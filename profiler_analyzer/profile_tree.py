import json
import collections
import logging
import os.path
import argparse
import sys
from os import listdir
from os.path import join
HASH_LIBRARY_LIST = ['hash','sha256','cryptonight','_mLoop']
class Node():
    def __init__(self, node_id, children, function_name,script_id, hit_count, url, depth):
        self.id =  node_id
        self.children = list(children)
        self.parent = 0
        self.function_name = function_name
        self.url = url
        self.hit_count = int(hit_count)
        self.script_id = int(script_id)
        self.isHash = False
        self.depth = depth
        
    def __repr__(self):
        return 'id : {}\tparent : {}\tchildren : {}\nfunctionname : {}\tisHash : {}\tdepth : {}\nhit count : {}'.format(self.id, self.parent, self.children, self.function_name, self.isHash, self.depth,self.hit_count)

class Tree():
    def __init__(self, file_pos):
        try:
            data = json.load(open(file_pos))
        except:
            raise ValueError('json file read error')
        self.nodes = data['nodes']
        self.samples = data['samples']
        self.time_deltas = data['timeDeltas']
        self.nodes_tree = {}
        self.isJse = False
        self.nodes_tree[0] = Node(0,[],'foo','0','0','bar',0)
        for node in self.nodes:
            children = node['children'] if 'children' in node else []
            self.nodes_tree[node['id']] = Node(node['id'],children,node['callFrame']['functionName'],node['callFrame']['scriptId'],node['hitCount'],node['callFrame']['url'],0)
        for idx, node in self.nodes_tree.items():
            for child in node.children:
                self.nodes_tree[child].parent = node.id
        self.judgeIsHash()

    def judgeIsHash(self):
        for idx, node in self.nodes_tree.items():
            if any(word in node.function_name.lower() for word in HASH_LIBRARY_LIST) or self.nodes_tree[node.parent].isHash is True:
                node.isHash = True
            node.depth = self.nodes_tree[node.parent].depth + 1
            
    def calc_hash_time_percent(self, timeLimit=1):
        rightBound = int(timeLimit * len(self.samples))
        totalTime = sum(self.time_deltas[:rightBound])
        hashTime = 0
        for idx, sample in enumerate(self.samples[:rightBound]):
            if self.nodes_tree[sample].isHash:
                hashTime += self.time_deltas[idx]
        hashTimeProportion = (hashTime/totalTime)*100
        return hashTimeProportion

    def calc_concrete_percent(self):
        totalSamples = 0
        maxConcentrated = 0
        maxConcentratedIdx = -1
        for node in self.nodes:
            if node['callFrame']['functionName'] != '(idle)':
                totalSamples += int(node['hitCount'])
        if totalSamples == 0:
            return 0
        for node in self.nodes:
            if node['callFrame']['functionName'] not in  ['(idle)', '(program)', '(root)','(garbage collector)'] and node['hitCount']>500 :
                curConcentrate = node['hitCount'] / totalSamples
                curConcentrateIdx = node['id']
                maxConcentratedIdx  = curConcentrateIdx if curConcentrate > maxConcentrated else maxConcentratedIdx
                maxConcentrated  = curConcentrate if curConcentrate > maxConcentrated else maxConcentrated
        if self.calc_periodic(maxConcentratedIdx) == False or len(self.nodes) > 100:
            return 0
        return maxConcentrated * 100

    def calc_periodic(self, maxConcentratedIdx):
        hotspot_swap_cnt = 0
        max_windows_size = 5
        samples_serial = [str(self.samples[0])]
        clear_samples = [str(node['id']) for node in self.nodes if node['hitCount']>100]
        for sample in self.samples:
            sample = str(sample)
            if sample not in clear_samples:
                continue
            if samples_serial[-1] != sample:
                if sample == str(maxConcentratedIdx):
                    hotspot_swap_cnt += 1
                samples_serial.append(sample)
        if hotspot_swap_cnt * 100 > len(self.samples) :
            return 0      
        serial_cnt = collections.defaultdict(int)
        for window_size in range(2, max_windows_size+1):
            start_pos = 0
            while start_pos+window_size <= len(samples_serial):
                key = ','.join(samples_serial[start_pos:start_pos+window_size])
                serial_cnt[key] += 1
                start_pos += 1
    
        for k,v in serial_cnt.items():
            if (k.count(',')+1) * v > len(samples_serial) * 0.5 and str(maxConcentratedIdx) in k.split(',') :
                return 1
        return 0

def get_files_from_dir(path):
    return [f for f in listdir(path) if os.path.isfile(join(path, f)) and not f.startswith('.')]

DEBUG_MODE = False
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('files', help='analyze file or directory')
    parser.add_argument("-v", "--verbose", help="increase output verbosity",
                    action="store_true")
    files = parser.parse_args().files
    repeat_threshold = 30
    hash_threshold = 10
    if parser.parse_args().verbose:
        DEBUG_MODE = True
    if os.path.isdir(files):
        base_dir = files if files.endswith('/') else files + '/'
        for f in get_files_from_dir(base_dir):
            sample = Tree(base_dir+f)
            if sample.calc_hash_time_percent() > hash_threshold:
                print('file {} is detect mining by hash based profiler'.format(f))
            if sample.calc_concrete_percent() > repeat_threshold:
                print('file {} is detect mining by stack structure based profiler'.format(f))
            sample.calc_concrete_percent()
    elif os.path.isfile(files):
        sample = Tree(files)
        if sample.calc_hash_time_percent() > hash_threshold:
            print('file {} is detect mining by hash based profiler'.format(files))
        if sample.calc_concrete_percent() > repeat_threshold:
            print('file {} is detect mining by stack structure based profiler'.format(files))
        
